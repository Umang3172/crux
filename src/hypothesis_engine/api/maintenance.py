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

from ..forecast import replay
from ..forecast.schedule import risk_before_hours
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


class TicketRequest(BaseModel):
    machine: str
    part: str
    at_h: float = Field(description="Running hour of the recording the ticket is written at.")
    stop_in_h: float | None = Field(default=None, description="Hours to the next planned stop.")


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
