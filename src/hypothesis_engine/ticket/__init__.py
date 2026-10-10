"""Repair tickets: the predictive-maintenance alarm turned into work a person approves.

`draft` builds a ticket from evidence and keeps only sentences the evidence
backs; `camera` adds a CCTV still and what an inspector saw in it. Neither reads
or writes an investigation's beliefs.
"""

from .camera import CameraLook, Finding, Still, inspect, snapshot
from .draft import Evidence, Sentence, Ticket, check, draft

__all__ = [
    "CameraLook",
    "Evidence",
    "Finding",
    "Sentence",
    "Still",
    "Ticket",
    "check",
    "draft",
    "inspect",
    "snapshot",
]
