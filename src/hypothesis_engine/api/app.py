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
from ..data.rig import BENCH_RIG, rig_oracle, synthetic_capture
from ..investigation.catalog import BY_ID, CATALOG
from ..investigation.engine import Investigation
from ..models import FaultKind, InvestigationState

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
                "kind": h.kind.value,
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
        "outcomes": [
            {"test_id": o.test_id, "feature": o.feature, "value": round(o.value, 4)}
            for o in state.outcomes
        ],
        "transcript": state.transcript,
        "conclusion": None
        if state.conclusion is None
        else {
            "root_cause": state.conclusion.root_cause.value,
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
            "predictions": {k.value: v for k, v in t.predictions.items()},
        }
        for t in CATALOG
    ]


@app.post("/investigations")
def start(req: StartRequest) -> dict[str, Any]:
    """Open an investigation on a capture. Runs observe + virtual experiments."""
    obs = synthetic_capture(req.fault, BENCH_RIG, rpm=req.rpm, severity=req.severity, seed=req.seed)
    inv = Investigation(BENCH_RIG, obs)
    inv.observe()
    inv.run_virtual_experiments()
    choice = inv.choose_next_test()
    if choice:
        inv.request(choice)
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
    inv.apply_outcome(req.test_id, req.value, collected_by=req.collected_by)
    if inv.state.leader().posterior >= 0.8:
        inv.conclude()
    else:
        choice = inv.choose_next_test()
        if choice:
            inv.request(choice)
        else:
            inv.conclude()
    inv.state.ledger = inv.ledger.items
    return serialise(inv.state)


@app.post("/replay")
def replay(req: StartRequest) -> dict[str, Any]:
    """Run a whole investigation start to finish, answered by the synthetic rig.

    This is what a judge sees with no hardware in front of them.
    """
    obs = synthetic_capture(req.fault, BENCH_RIG, rpm=req.rpm, severity=req.severity, seed=req.seed)
    inv = Investigation(BENCH_RIG, obs)
    state = inv.run(oracle=rig_oracle(req.fault, BENCH_RIG))
    state.extra["ground_truth"] = req.fault.value
    _INVESTIGATIONS[state.id] = inv
    return serialise(state)


# Predictive maintenance: replays of recorded bearing lives. Its own module, and
# it reads no investigation, so nothing it serves can move a belief.
from .maintenance import router as _maintenance  # noqa: E402

app.include_router(_maintenance)
