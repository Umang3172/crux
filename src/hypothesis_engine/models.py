"""Core domain types.

Everything the investigation touches is one of these. Keep them small, typed and
serialisable: the API, the agents and the tests all speak this vocabulary.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

import numpy as np


def _now() -> datetime:
    return datetime.now(UTC)


class FaultKind(StrEnum):
    """The fault hypotheses this version can reason about.

    Keep this list short. Every entry needs a predicted signature in
    `physics.signatures` and a row in docs/DOMAIN.md.
    """

    HEALTHY = "healthy"
    IMBALANCE = "imbalance"
    MISALIGNMENT = "misalignment"
    LOOSENESS = "looseness"
    OUTER_RACE = "outer_race"
    INNER_RACE = "inner_race"


@dataclass(frozen=True)
class BearingGeometry:
    """Rolling-element bearing geometry, the input to the fault frequencies."""

    n_rolling_elements: int
    ball_diameter_mm: float
    pitch_diameter_mm: float
    contact_angle_deg: float = 0.0
    label: str = "unknown"


# The drive-end bearing in the CWRU test rig; its published multipliers are the
# reference values in tests/test_frequencies.py.
SKF_6205_2RS_JEM = BearingGeometry(
    n_rolling_elements=9,
    ball_diameter_mm=7.94,
    pitch_diameter_mm=39.04,
    contact_angle_deg=0.0,
    label="SKF 6205-2RS JEM (CWRU drive end)",
)


@dataclass(frozen=True)
class MachineSpec:
    """What we know about the machine before any measurement."""

    machine_id: str
    name: str
    bearing: BearingGeometry
    nominal_rpm: float
    sample_rate_hz: float = 12_000.0
    blade_count: int = 0
    notes: str = ""


@dataclass
class Observation:
    """One capture from a machine: a waveform plus its operating context."""

    machine_id: str
    waveform: np.ndarray
    sample_rate_hz: float
    rpm: float
    temperature_c: float | None = None
    source: str = "rig"
    captured_at: datetime = field(default_factory=_now)

    @property
    def duration_s(self) -> float:
        return len(self.waveform) / self.sample_rate_hz


@dataclass
class Evidence:
    """One line in the ledger. Every claim the agent makes cites these."""

    id: str
    statement: str
    value: float | str | None
    unit: str
    source: str  # sensor | physics | virtual_experiment | human_measurement | operator
    at: datetime = field(default_factory=_now)

    def render(self) -> str:
        val = "" if self.value is None else f" = {self.value}{self.unit}"
        return f"{self.id} · {self.statement}{val} · {self.source}"


@dataclass
class Hypothesis:
    """A candidate physical explanation, with the belief attached to it."""

    kind: FaultKind
    prior: float
    posterior: float
    rejected: bool = False
    correlation: float | None = None
    supports: list[str] = field(default_factory=list)  # evidence ids
    tensions: list[str] = field(default_factory=list)  # evidence ids that do not fit

    @property
    def label(self) -> str:
        return self.kind.value.replace("_", " ")


@dataclass
class TestOutcome:
    """The result of a requested measurement."""

    test_id: str
    feature: str
    value: float
    collected_by: str = "technician"
    at: datetime = field(default_factory=_now)


@dataclass
class Conclusion:
    root_cause: FaultKind
    confidence: float
    reasoning: str
    recommended_action: str
    what_would_change_my_mind: str
    evidence_ids: list[str]


@dataclass
class InvestigationState:
    """Everything about one investigation. The API serialises this."""

    id: str
    machine: MachineSpec
    rpm: float
    hypotheses: list[Hypothesis]
    ledger: list[Evidence] = field(default_factory=list)
    requested_tests: list[str] = field(default_factory=list)
    outcomes: list[TestOutcome] = field(default_factory=list)
    conclusion: Conclusion | None = None
    transcript: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)

    def belief(self) -> dict[FaultKind, float]:
        return {h.kind: h.posterior for h in self.hypotheses}

    def leader(self) -> Hypothesis:
        return max(self.hypotheses, key=lambda h: h.posterior)

    def surviving(self, floor: float = 0.05) -> list[Hypothesis]:
        return [h for h in self.hypotheses if not h.rejected and h.posterior >= floor]
