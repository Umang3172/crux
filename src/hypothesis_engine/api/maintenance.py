"""Predictive maintenance endpoints: replays of recorded bearing lives.

Read-only. The numbers come from `forecast.replay`, which never touches an
investigation, so nothing served here can move a belief. With no health tables
on the server the list is empty and says why, rather than failing.
"""

from __future__ import annotations

import itertools
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from ..data import xjtu
from ..forecast import replay, runs
from ..forecast.schedule import risk_before_hours
from ..investigation.catalog import BY_ID
from ..investigation.engine import CONCLUDE_ABOVE
from ..investigation.recorded import investigate_recording
from ..ticket import camera
from ..ticket.draft import Ticket
from ..ticket.draft import draft as draft_ticket

router = APIRouter(prefix="/maintenance", tags=["predictive maintenance"])


@lru_cache(maxsize=1)
def _machines() -> tuple[dict[str, Any], ...]:
    return tuple(replay.load_or_build())


@router.get("/machines")
def machines() -> dict[str, Any]:
    """One summary per machine; the parts' full replays come from the next endpoint."""
    rows = []
    for m in _machines():
        parts = m["parts"]
        rows.append(
            {
                "machine": m["machine"],
                "name": m["name"],
                "source": m["source"],
                "end_h": m["end_h"],
                "parts": len(parts),
                "failed": [p["label"] for p in parts if p["failed"]],
                "lowest_percent": min(p["percent"][-1] for p in parts),
            }
        )
    note = "" if rows else "No run-to-failure data on this server: run scripts/forecast.py table."
    return {"machines": rows, "note": note}


def _find(machine: str) -> dict[str, Any]:
    for m in _machines():
        if m["machine"] == machine:
            return m
    raise HTTPException(404, f"no machine {machine!r}")


def _part(m: dict[str, Any], part: str) -> dict[str, Any]:
    for p in m["parts"]:
        if p["part"] == part:
            return p
    raise HTTPException(404, f"no part {part!r} on {m['machine']!r}")


def _at(values: list[float], times: list[float], at_h: float) -> float:
    i = max((k for k, t in enumerate(times) if t <= at_h), default=0)
    return values[i]


def _range_at(p: dict[str, Any], at_h: float) -> dict[str, Any] | None:
    shown = [r for r in p["time_left"] if r["at_h"] <= at_h and r["p50_h"] is not None]
    return shown[-1] if shown else None


@router.get("/machines/{machine:path}")
def machine(machine: str) -> dict[str, Any]:
    return _find(machine)


@router.get("/risk")
def risk(machine: str, part: str, at_h: float, stop_in_h: float) -> dict[str, Any]:
    """Chance the part reaches the danger line before a planned stop `stop_in_h` hours away."""
    r = _range_at(_part(_find(machine), part), at_h)
    if r is None:
        return {"risk": None, "note": "no time-left range yet: the alarm has not fired"}
    return {
        "risk": risk_before_hours(r["p10_h"], r["p50_h"], r["p90_h"], stop_in_h),
        "range": r,
        "note": "read from the range as a log-normal; a planning aid, not a promise",
    }


@lru_cache(maxsize=1)
def _xjtu_runs() -> dict[str, runs.Run]:
    return {r.run_id: r for r in runs.xjtu_runs()}


@lru_cache(maxsize=256)
def _investigate(run_id: str, minute: int) -> dict[str, Any]:
    run = _xjtu_runs()[run_id]
    st = investigate_recording(
        xjtu.machine(run), lambda i: xjtu.observation(run, i), minute, len(run)
    )
    ranked = sorted(st.hypotheses, key=lambda h: h.posterior, reverse=True)
    lead = ranked[0]
    c = st.conclusion
    confident = c is not None and c.confidence >= CONCLUDE_ABOVE
    checks = [{"test": o.test_id, "value": round(o.value, 3)} for o in getattr(st, "outcomes", [])]
    if confident:
        said = f"Crux's investigation points to {lead.label.lower()} (belief {lead.posterior:.2f})."
    else:
        asked = ", ".join(BY_ID[t].name.lower() for t in st.requested_tests) or "nothing more"
        said = (
            f"Crux could not settle the cause yet: leading suspect {lead.label.lower()} "
            f"(belief {lead.posterior:.2f}); it asked for {asked}."
        )
    return {
        "confident": confident,
        "leader": {"kind": lead.kind.value, "label": lead.label, "belief": lead.posterior},
        "ranked": [
            {"kind": h.kind.value, "label": h.label, "belief": h.posterior} for h in ranked[:4]
        ],
        "asked": [BY_ID[t].name for t in st.requested_tests],
        "answered": checks,
        "transcript": list(st.transcript),
        "statement": said,
        "reading": f"recorded minute {minute + 1}; checks answered from the minutes after it",
    }


def _run_for(m: dict[str, Any], p: dict[str, Any]) -> runs.Run | None:
    return _xjtu_runs().get(p["part"]) if m["machine"].startswith("xjtu/") else None


class InvestigateRequest(BaseModel):
    machine: str
    part: str
    at_h: float


@router.post("/investigate")
def investigate(req: InvestigateRequest) -> dict[str, Any]:
    """What is wrong, from the recording at that moment. XJTU-SY only: its bearing is on file."""
    m = _find(req.machine)
    p = _part(m, req.part)
    run = _run_for(m, p)
    if run is None:
        raise HTTPException(
            409, "this rig's bearing dimensions are not on file (TBD), so Crux cannot simulate it"
        )
    minute = min(max(int(round(req.at_h * 60)), 0), len(run) - 1)
    return _investigate(run.run_id, minute)


class TicketRequest(BaseModel):
    machine: str
    part: str
    at_h: float = Field(description="Running hour of the recording the ticket is written at.")
    stop_in_h: float | None = Field(default=None, description="Hours to the next planned stop.")
    investigate: bool = Field(
        default=True, description="Run the investigation where the rig is on file."
    )


_TICKETS: dict[str, Ticket] = {}
_STILLS: dict[str, camera.Still] = {}
_IDS = itertools.count(1)


@router.post("/tickets")
def new_ticket(req: TicketRequest) -> dict[str, Any]:
    m = _find(req.machine)
    p = _part(m, req.part)
    if p["alarm_h"] is None or p["alarm_h"] > req.at_h:
        raise HTTPException(409, "no alarm on this part at that time: nothing to ticket yet")
    r = _range_at(p, req.at_h)
    level = _at(p["level"], p["t_h"], req.at_h)
    risk_ = (
        risk_before_hours(r["p10_h"], r["p50_h"], r["p90_h"], req.stop_in_h)
        if r is not None and req.stop_in_h is not None
        else None
    )
    still = camera.snapshot(req.machine)
    look = None
    if still is not None:
        context = f"{p['label']} on {m['name']}: vibration {level:.1f} times its normal level"
        look = camera.inspect(still, context)
    diagnosis = None
    run = _run_for(m, p) if req.investigate else None
    if run is not None:
        minute = min(max(int(round(req.at_h * 60)), 0), len(run) - 1)
        diagnosis = _investigate(run.run_id, minute)["statement"]
    tid = f"T-{next(_IDS):04d}"
    t = draft_ticket(
        ticket_id=tid,
        machine=m["machine"],
        machine_name=m["name"],
        part=p["part"],
        part_label=p["label"],
        bearing=m.get("bearing", "TBD"),
        at_h=req.at_h,
        percent=_at(p["percent"], p["t_h"], req.at_h),
        level=level,
        alarm_h=p["alarm_h"],
        time_left=(r["p10_h"], r["p50_h"], r["p90_h"]) if r is not None else None,
        stop_in_h=req.stop_in_h if risk_ is not None else None,
        risk=risk_,
        look=look,
        has_still=still is not None,
        diagnosis=diagnosis,
    )
    _TICKETS[tid] = t
    if still is not None:
        _STILLS[tid] = still
    return t.to_dict()


@router.get("/tickets")
def tickets() -> list[dict[str, Any]]:
    return [t.to_dict() for t in _TICKETS.values()]


@router.get("/tickets/{ticket_id}/still")
def ticket_still(ticket_id: str) -> Response:
    still = _STILLS.get(ticket_id)
    if still is None:
        raise HTTPException(404, "no camera still on this ticket")
    return Response(still.image, media_type=still.mime)


class Approval(BaseModel):
    by: str = Field(min_length=1, description="Who approves: a person, never the system.")


@router.post("/tickets/{ticket_id}/approve")
def approve(ticket_id: str, a: Approval) -> dict[str, Any]:
    t = _TICKETS.get(ticket_id)
    if t is None:
        raise HTTPException(404, f"no ticket {ticket_id!r}")
    t.status, t.approved_by = "approved", a.by
    return t.to_dict()
