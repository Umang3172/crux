"""Learning endpoints: this site's updates and lessons, and what a technician found.

`CRUX_SITE` names this site (default "this-site"). `CRUX_SITE_TABLES` lists the
health tables that hold this site's own failures (default: every table), the
failures an update is tested on. `CRUX_HUB` points at the hub folder.
"""

from __future__ import annotations

import os
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..fleet import Hub, Site, machine_type_of
from ..fleet.learn import lesson_from_outcome
from ..forecast import health
from ..forecast.replay import FORECAST_DIR

router = APIRouter(prefix="/fleet", tags=["learning across sites"])


def site() -> Site:
    return Site(os.getenv("CRUX_SITE", "this-site"))


def own_runs() -> list[health.RunHealth]:
    names = [n for n in os.getenv("CRUX_SITE_TABLES", "").split(",") if n.strip()]
    tables = [FORECAST_DIR / n.strip() for n in names] or sorted(FORECAST_DIR.glob("health_*.csv"))
    return [health.trim_stopped(h) for t in tables if t.exists() for h in health.load(t)]


@router.get("/status")
def status() -> dict[str, Any]:
    s = site()
    st = s.state()
    hub = Hub()
    return {
        "site": s.site_id,
        "active": st["active"],
        "staged": st["staged"],
        "history": st["history"][-5:],
        "hub_versions": hub.versions(),
        "lessons": len(s.memory.all()),
        "model": s.forecaster().name,
    }


@router.post("/pull")
def pull() -> dict[str, Any]:
    hub = Hub()
    if not hub.root.exists():
        raise HTTPException(409, f"no hub at {hub.root}: run scripts/fleet_demo.py or set CRUX_HUB")
    return site().pull(hub, own_runs())


class Person(BaseModel):
    by: str = Field(min_length=1, description="The person deciding. Never the system.")


@router.post("/approve")
def approve(p: Person) -> dict[str, Any]:
    try:
        return site().approve(p.by)
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


@router.post("/rollback")
def rollback(p: Person) -> dict[str, Any]:
    try:
        return site().rollback(p.by)
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


@router.get("/lessons")
def lessons(machine_type: str = "rolling bearing", q: str = "", k: int = 10) -> list[dict]:
    mem = site().memory
    found = (
        mem.recall(machine_type, q, k)
        if q
        else [x for x in mem.all() if x.machine_type == machine_type][-k:]
    )
    return [asdict(x) for x in found]


class Outcome(BaseModel):
    ticket_id: str
    found: str = Field(
        min_length=1, description="What the technician found when they opened it up."
    )
    right: bool = Field(description="Did Crux's ticket point the right way?")
    by: str = Field(min_length=1)
    major: bool = Field(default=False, description="A major failure: tell every site at once.")


@router.post("/outcome")
def outcome(o: Outcome) -> dict[str, Any]:
    """Close a case: write the lesson here, and send it (with the trend) to the hub."""
    from .maintenance import _TICKETS

    t = _TICKETS.get(o.ticket_id)
    if t is None:
        raise HTTPException(404, f"no ticket {o.ticket_id!r}")
    said = next((x.statement for x in t.evidence if x.id == "E6"), "no cause named")
    situation = "; ".join(x.statement for x in t.evidence if x.id in ("E1", "E2", "E5"))
    s = site()
    lesson = lesson_from_outcome(
        machine_type=machine_type_of(t.machine),
        case_id=t.id,
        situation=situation,
        said=said,
        found=o.found,
        right=o.right,
        confirmed_by=o.by,
        source=s.site_id,
    )
    s.memory.add([lesson])
    record = next((h for h in own_runs() if h.run_id == t.part), None)
    hub = Hub()
    alert = None
    if hub.root.exists():
        alert = hub.contribute(s.site_id, lesson, record, major=o.major)
    return {
        "lesson": asdict(lesson),
        "sent_to_hub": hub.root.exists(),
        "alert": str(alert) if alert else None,
    }
