"""HTTP surface.

Two audiences:

* the web UI (an investigation is a resource you can watch and answer),
* a judge with only the deployed link, who runs `/replay` and sees a full case.

Keep this layer thin: it serialises engine state, it does not decide anything.
"""

from __future__ import annotations

import hmac
import inspect
import os
from dataclasses import asdict
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from ..agents.factory import describe as describe_models
from ..agents.trace import describe
from ..data.rig import (
    BENCH_RIG,
    BENCH_RIG_ESP32,
    OFF_CATALOGUE,
    OffCatalogue,
    rig_oracle,
    synthetic_capture,
)
from ..data.stream import CAPTURE_S, MAX_BATCH_SAMPLES, NotEnoughSignal, Stream, Streams
from ..investigation.catalog import BY_ID, CATALOG
from ..investigation.engine import Investigation
from ..investigation.notes import MAX_NOTE_CHARS
from ..investigation.notes import flag as hazard_flag
from ..investigation.repair import NothingToVerify, RepairCheck, check_repair
from ..models import FaultKind, InvestigationState
from ..tools import CaseNotFound, InMemoryCaseStore, open_case, record_note

app = FastAPI(
    title="Crux",
    version="0.1.0",
    summary="An AI investigator for machine faults, built by MechNova.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_INVESTIGATIONS: dict[str, Investigation] = {}


def serialise(state: InvestigationState) -> dict[str, Any]:
    return {
        "id": state.id,
        "machine": {"id": state.machine.machine_id, "name": state.machine.name},
        "rpm": round(state.rpm, 1),
        "hypotheses": [
            {
                "kind": h.name,
                "origin": h.origin,
                "label": h.label,
                "posterior": round(h.posterior, 4),
                "correlation": None if h.correlation is None else round(h.correlation, 3),
                "rejected": h.rejected,
                "supports": h.supports,
                "tensions": h.tensions,
            }
            for h in sorted(state.hypotheses, key=lambda h: h.posterior, reverse=True)
        ],
        "ledger": [
            {
                "id": e.id,
                "statement": e.statement,
                "value": e.value,
                "unit": e.unit,
                "source": e.source,
                "at": e.at.isoformat(),
            }
            for e in state.ledger
        ],
        "requested_tests": state.requested_tests,
        "request": state.extra.get("request"),
        # Set when the engine weighed the menu and asked for nothing, with the menu.
        "no_test": state.extra.get("no_test"),
        "outcomes": [
            {"test_id": o.test_id, "feature": o.feature, "value": round(o.value, 4)}
            for o in state.outcomes
        ],
        "transcript": state.transcript,
        # What people typed about the machine. Not evidence: apart from the ledger.
        "notes": [
            {"id": n.id, "text": n.text, "by": n.by, "hazards": n.hazards, "at": n.at.isoformat()}
            for n in state.notes
        ],
        # Set when a note describes a hazard: a flag for a person, above everything else.
        "hazard": hazard_flag(state.notes),
        "outcome": state.outcome,
        "unresolved_reason": state.unresolved_reason,
        # Set when the case was scored against the machine's own healthy captures.
        "own_normal": state.extra.get("own_normal"),
        "conclusion": None
        if state.conclusion is None
        else {
            "root_cause": state.conclusion.cause,
            "confidence": round(state.conclusion.confidence, 4),
            "reasoning": state.conclusion.reasoning,
            "recommended_action": state.conclusion.recommended_action,
            "what_would_change_my_mind": state.conclusion.what_would_change_my_mind,
            "limit": state.conclusion.limit,
            "caveat": state.conclusion.caveat,
            "cannot_exclude": [
                {"kind": name, "severity": severity} for name, severity in state.conclusion.unseen
            ],
            "evidence_ids": state.conclusion.evidence_ids,
        },
    }


class StartRequest(BaseModel):
    fault: FaultKind = Field(
        default=FaultKind.OUTER_RACE,
        description="Which fault to induce on the synthetic rig. Replaced by a real capture once the rig streams.",
    )
    rpm: float | None = None
    severity: float = 1.0
    seed: int = 1234
    extra_noise: float = Field(
        default=0.05,
        ge=0.0,
        description="Added sensor noise. Raise it, with a low severity, for a case the physics "
        "cannot settle without a measurement.",
    )


def _rig_state(req: StartRequest) -> dict[str, Any]:
    """What the synthetic rig was given, kept with the case so the rig can be
    captured again after a repair. Demo only; the engine never reads it."""
    return {
        "fault": str(req.fault.value if isinstance(req.fault, FaultKind) else req.fault),
        "severity": req.severity,
        "extra_noise": req.extra_noise,
        "rpm": req.rpm,
    }


def _rig_answers(req: StartRequest):
    """The rig's answers for a replay: new captures of the machine the case was opened on."""
    return rig_oracle(
        req.fault, BENCH_RIG, severity=req.severity, extra_noise=req.extra_noise, rpm=req.rpm
    )


class AgentReplayRequest(StartRequest):
    fault: FaultKind | OffCatalogue = Field(
        default=FaultKind.OUTER_RACE,
        description="A catalogue fault, or one the catalogue does not list (rolling_element, "
        "unlisted_impact): the investigator has to notice the list is missing a cause.",
    )
    note: str = Field(
        default="",
        max_length=MAX_NOTE_CHARS,
        description="A technician's note put on the case before the investigator starts. The "
        "investigator reads it as data; it moves nothing by itself.",
    )


class NoteRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_NOTE_CHARS)
    by: str = Field(default="technician", max_length=60)


class EvidenceRequest(BaseModel):
    test_id: str
    value: float
    collected_by: str = "technician"


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "models": describe_models()}


@app.get("/tests")
def tests() -> list[dict[str, Any]]:
    """The measurement catalogue, including the coaching steps for each one."""
    return [
        {
            "id": t.id,
            "name": t.name,
            "feature": t.feature,
            "effort_min": t.effort_min,
            "downtime": t.downtime,
            "coach_prompt": t.coach_prompt,
            "procedure": list(t.procedure),
            "capture_s": t.capture_s,
            "predictions": {k.value: v for k, v in t.predictions.items()},
        }
        for t in CATALOG
    ]


@app.post("/investigations")
def start(req: StartRequest) -> dict[str, Any]:
    """Open an investigation on a capture. Runs observe + virtual experiments."""
    obs = synthetic_capture(
        req.fault,
        BENCH_RIG,
        rpm=req.rpm,
        severity=req.severity,
        seed=req.seed,
        extra_noise=req.extra_noise,
    )
    inv = Investigation(BENCH_RIG, obs)
    inv.observe()
    inv.run_virtual_experiments()
    inv.advance()
    inv.state.extra["ground_truth"] = req.fault.value  # demo only; never shown to the agent
    inv.state.extra["rig"] = _rig_state(req)
    inv.state.ledger = inv.ledger.items
    _INVESTIGATIONS[inv.state.id] = inv
    return serialise(inv.state)


@app.get("/investigations/{investigation_id}")
def get(investigation_id: str) -> dict[str, Any]:
    inv = _INVESTIGATIONS.get(investigation_id)
    if inv is None:
        raise HTTPException(404, "no such investigation")
    inv.state.ledger = inv.ledger.items
    return serialise(inv.state)


@app.post("/investigations/{investigation_id}/evidence")
def add_evidence(investigation_id: str, req: EvidenceRequest) -> dict[str, Any]:
    """Hand back a measurement the agent asked for."""
    inv = _INVESTIGATIONS.get(investigation_id)
    if inv is None:
        raise HTTPException(404, "no such investigation")
    if req.test_id not in BY_ID:
        raise HTTPException(400, f"unknown test {req.test_id}")
    if inv.state.outcome != "open":
        raise HTTPException(409, f"the investigation is {inv.state.outcome}")
    inv.apply_outcome(req.test_id, req.value, collected_by=req.collected_by)
    inv.advance()
    inv.state.ledger = inv.ledger.items
    return serialise(inv.state)


@app.post("/replay")
def replay(req: StartRequest) -> dict[str, Any]:
    """Run a whole investigation start to finish, answered by the synthetic rig.

    This is what a judge sees with no hardware in front of them.
    """
    obs = synthetic_capture(
        req.fault,
        BENCH_RIG,
        rpm=req.rpm,
        severity=req.severity,
        seed=req.seed,
        extra_noise=req.extra_noise,
    )
    inv = Investigation(BENCH_RIG, obs)
    state = inv.run(oracle=_rig_answers(req))
    state.extra["ground_truth"] = req.fault.value
    state.extra["rig"] = _rig_state(req)
    _INVESTIGATIONS[state.id] = inv
    return serialise(state)


# ------------------------------------------------------------------ a live sensor

#: Machines whose bearing and speed are on file, so their signal can be simulated.
_LIVE = Streams({BENCH_RIG_ESP32.machine_id: BENCH_RIG_ESP32})


class IngestBatch(BaseModel):
    """One batch as the rig's firmware posts it (`firmware/esp32_rig`)."""

    machine_id: str
    token: str = ""
    sample_rate_hz: float = Field(gt=0)
    started_at_ms: float = Field(ge=0, description="The sensor's own clock at the first sample.")
    scale_g_per_lsb: float = Field(default=1.0, gt=0, description="Raw counts times this is g.")
    samples: list[float] = Field(min_length=1, max_length=MAX_BATCH_SAMPLES)


class IngestToken(BaseModel):
    token: str = ""


def _ingest_allowed(token: str) -> None:
    """Writes from a sensor are off unless the server was given a token, and then
    only for a caller that has it: the deployed link is open to anyone."""
    expected = os.getenv("RIG_INGEST_TOKEN")
    if not expected:
        raise HTTPException(
            503, "sensor ingestion is off on this server: set RIG_INGEST_TOKEN to turn it on"
        )
    if not hmac.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(401, "wrong ingest token")


def _live(machine_id: str) -> Stream:
    try:
        return _LIVE.get(machine_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc.args[0])) from None


def _stream_status(stream: Stream) -> dict[str, Any]:
    return {
        "machine": stream.machine.machine_id,
        "name": stream.machine.name,
        "sample_rate_hz": stream.machine.sample_rate_hz,
        "seconds": round(stream.seconds, 2),
        "batches": stream.batches,
        "normal_captures": len(stream.normal),
        "ready": stream.seconds >= CAPTURE_S,
    }


@app.post("/ingest")
def ingest(batch: IngestBatch) -> dict[str, Any]:
    """Take one batch of samples from a sensor. The server keeps the latest
    unbroken stretch per machine; a batch that does not follow on starts a new one."""
    _ingest_allowed(batch.token)
    _live(batch.machine_id)
    try:
        stream = _LIVE.add(
            batch.machine_id,
            batch.sample_rate_hz,
            batch.started_at_ms,
            np.asarray(batch.samples, dtype=float) * batch.scale_g_per_lsb,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    return _stream_status(stream)


@app.get("/ingest/{machine_id}")
def ingest_status(machine_id: str) -> dict[str, Any]:
    """How much signal is on hand for a machine, and whether its normal is marked."""
    return _stream_status(_live(machine_id))


@app.post("/ingest/{machine_id}/normal")
def ingest_normal(machine_id: str, who: IngestToken) -> dict[str, Any]:
    """Keep the latest signal as this machine running normally. A person's call:
    every later case is scored on the change from it."""
    _ingest_allowed(who.token)
    stream = _live(machine_id)
    try:
        _LIVE.mark_normal(machine_id)
    except NotEnoughSignal as exc:
        raise HTTPException(409, str(exc)) from None
    return _stream_status(stream)


@app.post("/ingest/{machine_id}/investigate")
def ingest_investigate(machine_id: str, who: IngestToken) -> dict[str, Any]:
    """Open a case on the latest signal, against the machine's own normal when one
    is marked. It is a case like any other: answer what it asks through
    `/investigations/{id}/evidence`."""
    _ingest_allowed(who.token)
    stream = _live(machine_id)
    try:
        obs = _LIVE.capture(machine_id)
    except NotEnoughSignal as exc:
        raise HTTPException(409, str(exc)) from None
    inv = Investigation(stream.machine, obs, normal=stream.normal)
    inv.observe()
    inv.run_virtual_experiments()
    inv.advance()
    inv.state.ledger = inv.ledger.items
    _INVESTIGATIONS[inv.state.id] = inv
    return serialise(inv.state)


# Cases the investigator agent works on, through the tool layer.
_AGENT_CASES = InMemoryCaseStore()


@app.post("/agent/replay")
async def agent_replay(req: AgentReplayRequest) -> dict[str, Any]:
    """Run a whole case with the investigator agent driving the tools.

    Gemini when credentials are configured, the scripted offline investigator
    otherwise; `model` in the response says which. Readings come from the
    synthetic rig, never from the agent.
    """
    try:
        from ..agents.investigator import investigate_async
    except ImportError as exc:  # the agent framework is the optional `llm` extra
        raise HTTPException(503, f"the investigator needs the llm extra: {exc}") from exc
    obs = synthetic_capture(
        req.fault,
        BENCH_RIG,
        rpm=req.rpm,
        severity=req.severity,
        seed=req.seed,
        extra_noise=req.extra_noise,
    )
    case = open_case(_AGENT_CASES, BENCH_RIG, obs, answer_source=_rig_answers(req))
    case.investigation.state.extra["rig"] = _rig_state(req)
    if req.note.strip():
        record_note(_AGENT_CASES, case.id, req.note)
    run = await investigate_async(_AGENT_CASES, case.id)
    return {
        "model": run.model,
        # True when a Gemini model made the calls from start to finish.
        "live": run.model.startswith("gemini:") and run.fallback is None,
        "fallback": run.fallback,
        "rounds": run.rounds,
        "stopped": run.stopped,
        "tool_calls": [{"tool": name, "args": args} for name, args in run.tool_calls],
        "steps": [
            {"by": step.by, **asdict(describe(step.tool, step.args, step.result))}
            for step in run.steps
        ],
        "thoughts": run.thoughts,
        "ground_truth": str(req.fault),  # demo only; the investigator is never told
        "case": run.case.model_dump(mode="json") if run.case else None,
    }


@app.get("/agent/about")
def agent_about() -> dict[str, Any]:
    """What the investigator is, for the screen: which model would run, the tools
    it is given and the limits a run is held to. Read from the code, so the
    screen cannot promise more than the tool layer allows."""
    from ..tools import InvestigatorTools

    tools = InvestigatorTools(_AGENT_CASES)
    limits: dict[str, Any] = {}
    try:
        from ..agents import investigator as loop

        limits = {
            "rounds": loop.MAX_ROUNDS,
            "model_calls": loop.MAX_MODEL_CALLS,
            "seconds": loop.MAX_SECONDS,
        }
    except ImportError:  # the agent framework is the optional `llm` extra
        pass
    return {
        "models": describe_models(),
        "tools": [
            {
                "name": fn.__name__,
                "does": " ".join((fn.__doc__ or "").split()),
                "takes": [p for p in inspect.signature(fn).parameters if p != "case_id"],
            }
            for fn in tools.agent_functions()
        ],
        "limits": limits,
        "scenarios": [{"id": kind.value, "on_the_list": True} for kind in FaultKind]
        + [{"id": name, "on_the_list": False} for name in OFF_CATALOGUE],
    }


# ------------------------------------------------------------------ the report

#: Reports already written, by case and writer. A closed case does not change.
_REPORTS: dict[tuple[str, str], dict[str, Any]] = {}


def _case(case_id: str) -> Investigation:
    """A case by id, whichever door it was opened by."""
    inv = _INVESTIGATIONS.get(case_id)
    if inv is None:
        try:
            inv = _AGENT_CASES.get(case_id).investigation
        except CaseNotFound:
            raise HTTPException(404, "no such investigation") from None
    inv.state.ledger = inv.ledger.items
    return inv


def _closed_or_open_case(case_id: str) -> InvestigationState:
    return _case(case_id).state


@app.get("/investigations/{investigation_id}/report")
def report(investigation_id: str, writer: str = "") -> dict[str, Any]:
    """The case's result in words: the engine's own lines, and a model's
    explanation when one is on, each of its sentences kept only if the evidence
    it cites backs it. Reading a report never changes the case.

    `writer=careless` uses a test writer that makes false claims on purpose, so
    the check can be seen removing them. `writer=engine` asks for no model.
    """
    from ..agents import report as reports

    if writer not in ("", "careless", "engine"):
        raise HTTPException(400, "writer is one of: careless, engine")
    state = _closed_or_open_case(investigation_id)
    key = (state.id, writer)
    if key in _REPORTS:
        return _REPORTS[key]
    if writer == "careless":
        written = reports.write_report(state, reports.CarelessWriter())
    else:
        written = reports.write_report(state, look_for_model=writer != "engine")
    out = written.to_dict()
    if state.outcome != "open":
        _REPORTS[key] = out
    return out


# ------------------------------------------------------------------ a person's note


@app.post("/investigations/{investigation_id}/notes")
def add_note(investigation_id: str, req: NoteRequest) -> dict[str, Any]:
    """Put what a person sees, hears or smells on the case. A note is not
    evidence: it moves no belief and neither opens nor closes anything, whatever
    it says. If its words describe a hazard the case carries a flag for a person."""
    inv = _case(investigation_id)
    try:
        inv.add_note(req.text, by=req.by)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    _REPORTS.pop((inv.state.id, ""), None)  # the report states a hazard first
    _REPORTS.pop((inv.state.id, "engine"), None)
    _REPORTS.pop((inv.state.id, "careless"), None)
    return serialise(inv.state)


# ------------------------------------------------------------------ after the repair

#: How strong a fault the repair itself left behind is, on the synthetic rig. A
#: demonstration value: clear in one capture, short of the catalogue's full strength.
LEFT_BEHIND_SEVERITY = 0.75


class RepairRequest(BaseModel):
    """What the repair did, on the synthetic rig. With a sensor, the capture
    after the repair comes from it instead (`/ingest/{machine}/repair/{case}`)."""

    removed: float = Field(
        default=1.0, ge=0.0, le=1.0, description="How much of the fault it removed: 1 is all."
    )
    left_behind: FaultKind | None = Field(
        default=None,
        description="A fault the repair itself left, such as misalignment after reassembly.",
    )
    seed: int = 4242


def _repair_view(check: RepairCheck, rig: dict[str, Any] | None = None) -> dict[str, Any]:
    follow = check.follow
    follow.state.ledger = follow.ledger.items
    # The capture after the repair is a case of its own: its ledger and report
    # can be read like any other's.
    _INVESTIGATIONS[follow.state.id] = follow
    return {
        "outcome": check.outcome,
        "cause": check.cause,
        "found": check.found,
        "belief": None if check.belief is None else round(check.belief, 4),
        "statement": check.statement,
        "limit": check.limit,
        "limit_names_cause": check.limit_names_cause,
        "caveat": check.caveat,
        "lines": [asdict(change) for change in check.lines],
        "usual_from": check.usual_from,
        "asked": list(check.asked),
        "after": serialise(follow.state),
        "rig": rig,  # demo only: what the rig was given for the capture after the repair
    }


@app.post("/investigations/{investigation_id}/repair")
def repair(investigation_id: str, req: RepairRequest) -> dict[str, Any]:
    """Capture the synthetic rig again after the repair a verdict called for, and
    investigate that capture: is the cause gone, still there, or replaced by
    another? No expected improvement is typed anywhere: the answer is the
    engine's verdict on the machine as it now runs."""
    inv = _case(investigation_id)
    rig = inv.state.extra.get("rig")
    if rig is None:
        raise HTTPException(
            409, "this case was not opened on the synthetic rig; post the capture from the sensor"
        )
    left = rig["severity"] * (1.0 - req.removed)
    if req.left_behind is not None and left > 0:
        raise HTTPException(422, "the rig holds one fault at a time: left_behind needs removed=1")
    if req.left_behind is not None:
        given = {"fault": req.left_behind.value, "severity": LEFT_BEHIND_SEVERITY}
    elif left > 0:
        given = {"fault": rig["fault"], "severity": round(left, 4)}
    else:
        given = {"fault": FaultKind.HEALTHY.value, "severity": 1.0}
    after = synthetic_capture(
        given["fault"],
        BENCH_RIG,
        rpm=rig["rpm"],
        severity=given["severity"],
        seed=req.seed,
        extra_noise=rig["extra_noise"],
    )
    # The rig answers a requested measurement in the state the repair left it in,
    # the way it answered the first case.
    answers = rig_oracle(
        given["fault"],
        BENCH_RIG,
        severity=given["severity"],
        extra_noise=rig["extra_noise"],
        rpm=rig["rpm"],
    )
    try:
        check = check_repair(inv, after, answers)
    except NothingToVerify as exc:
        raise HTTPException(409, str(exc)) from None
    return _repair_view(check, given)


@app.post("/ingest/{machine_id}/repair/{investigation_id}")
def ingest_repair(machine_id: str, investigation_id: str, who: IngestToken) -> dict[str, Any]:
    """The same check on a real machine: the latest signal from its sensor is the
    capture after the repair, scored against the normal the first case had."""
    _ingest_allowed(who.token)
    stream = _live(machine_id)
    inv = _case(investigation_id)
    if inv.machine.machine_id != stream.machine.machine_id:
        raise HTTPException(409, f"that case is on {inv.machine.machine_id}, not {machine_id}")
    try:
        after = _LIVE.capture(machine_id)
    except NotEnoughSignal as exc:
        raise HTTPException(409, str(exc)) from None
    try:
        check = check_repair(inv, after)
    except NothingToVerify as exc:
        raise HTTPException(409, str(exc)) from None
    return _repair_view(check)


# Predictive maintenance: replays of recorded bearing lives. Its own module, and
# it reads no investigation, so nothing it serves can move a belief.
from .maintenance import router as _maintenance  # noqa: E402

app.include_router(_maintenance)

# Learning across sites: lessons, signed updates and what a technician found.
from .fleet import router as _fleet  # noqa: E402

app.include_router(_fleet)

# Crux Lens: a phone video of a machine, read by a vision model and by the physics.
from .lens import router as _lens  # noqa: E402

app.include_router(_lens)
