"""Specialist packs: one per machine type, under one general assistant.

The language model is shared: explaining, writing a ticket and reading a photo
are the same skill on any machine. What differs by machine type is the physics
and the data: which signals to watch, what counts as normal, which faults can
be named, and the time-left model. Those live in a pack, so a compressor never
borrows a bearing's thresholds and an update for one type never touches another.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Pack:
    machine_type: str
    signals: str
    normal: str
    faults: tuple[str, ...]
    model_file: str  # the time-left model's file name inside a site's active folder, "" if none


PACKS: dict[str, Pack] = {
    "rolling bearing": Pack(
        "rolling bearing",
        "vibration: RMS, peak, kurtosis, band energy (forecast/health.py)",
        "its own first snapshots (forecast/onset.py)",
        ("healthy", "imbalance", "misalignment", "looseness", "outer_race", "inner_race"),
        "rolling-bearing.pkl",
    ),
    "air compressor": Pack(
        "air compressor",
        "share of time loaded over 24 h; oil temperature; motor current (forecast/metropt.py)",
        "its own last 28 days, flagged hours left out (forecast/metropt.py)",
        ("air leak",),
        "",
    ),
}


def machine_type_of(machine: str) -> str:
    """The pack a machine belongs to, from its id."""
    if machine.startswith(("ims/", "xjtu/", "demo/")):
        return "rolling bearing"
    if machine.startswith("metropt"):
        return "air compressor"
    return "unknown"
