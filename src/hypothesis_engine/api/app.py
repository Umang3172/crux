"""HTTP surface.

Two audiences:

* the web UI (an investigation is a resource you can watch and answer),
* a judge with only the deployed link, who runs `/replay` and sees a full case.

Keep this layer thin: it serialises engine state, it does not decide anything.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from ..agents.factory import describe as describe_models
from ..data.rig import BENCH_RIG, OffCatalogue, rig_oracle, synthetic_capture
from ..investigation.catalog import BY_ID, CATALOG
from ..investigation.engine import Investigation
from ..models import FaultKind, InvestigationState
from ..tools import InMemoryCaseStore, open_case

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
        "outcomes": [
            {"test_id": o.test_id, "feature": o.feature, "value": round(o.value, 4)}
            for o in state.outcomes
        ],
        "transcript": state.transcript,
        "outcome": state.outcome,
        "unresolved_reason": state.unresolved_reason,
        "conclusion": None
        if state.conclusion is None
        else {
            "root_cause": state.conclusion.cause,
            "confidence": round(state.conclusion.confidence, 4),
            "reasoning": state.conclusion.reasoning,
            "recommended_action": state.conclusion.recommended_action,
            "what_would_change_my_mind": state.conclusion.what_would_change_my_mind,
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
    _INVESTIGATIONS[state.id] = inv
    return serialise(state)


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
    run = await investigate_async(_AGENT_CASES, case.id)
    return {
        "model": run.model,
        "rounds": run.rounds,
        "stopped": run.stopped,
        "tool_calls": [{"tool": name, "args": args} for name, args in run.tool_calls],
        "thoughts": run.thoughts,
        "case": run.case.model_dump(mode="json") if run.case else None,
    }


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
