"""The typed check used while a person takes a measurement.

`Gate` is a Protocol with an offline implementation, so the whole system runs
with no API keys at all. That is a deliberate constraint: keys are a hackathon
liability, and CI must never need one.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass
class GateVerdict:
    """A typed decision about the measurement in progress."""

    step_state: str  # placed | steady | capturing | done | retake | unclear
    confidence: float
    say: str
    escalate: bool = False


@runtime_checkable
class Gate(Protocol):
    """Fast, typed decisions while coaching a measurement."""

    name: str

    def check(self, scene: str, expected: str) -> GateVerdict: ...
