"""Predictive maintenance endpoints: replays of recorded bearing lives.

Read-only. The numbers come from `forecast.replay`, which never touches an
investigation, so nothing served here can move a belief. With no health tables
on the server the list is empty and says why, rather than failing.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from fastapi import APIRouter, HTTPException

from ..forecast import replay

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


@router.get("/machines/{machine:path}")
def machine(machine: str) -> dict[str, Any]:
    for m in _machines():
        if m["machine"] == machine:
            return m
    raise HTTPException(404, f"no machine {machine!r}")
