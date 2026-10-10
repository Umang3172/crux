"""Core domain types.

Everything the investigation touches is one of these. Keep them small, typed and
serialisable: the API, the agents and the tests all speak this vocabulary.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal

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
    """A candidate physical explanation, with the belief attached to it.

    Catalogue hypotheses have a `kind`. A suspect written during the case (by a
    person or a model) has `kind=None`, a `name`, and is simulated from the
    vibration it was written to predict.
    """

    kind: FaultKind | None
    prior: float
    posterior: float
    rejected: bool = False
    correlation: float | None = None
    supports: list[str] = field(default_factory=list)  # evidence ids
    tensions: list[str] = field(default_factory=list)  # evidence ids that do not fit
    name: str = ""
    origin: Literal["catalogue", "written"] = "catalogue"
    description: str = ""

    def __post_init__(self) -> None:
        if not self.name:
            if self.kind is None:
                raise ValueError("a hypothesis needs a kind or a name")
            self.name = self.kind.value

    @property
    def label(self) -> str:
        return self.name.replace("_", " ")


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
    root_cause: FaultKind | None  # None when the cause is a written suspect
    confidence: float
    reasoning: str
    recommended_action: str
    what_would_change_my_mind: str
    evidence_ids: list[str]
    cause: str = ""  # the hypothesis' name, set for every conclusion
    #: What a healthy verdict could not have seen: the mild faults that fit this
    #: evidence as well. It is also the last sentence of `reasoning`. Empty otherwise.
    limit: str = ""
    #: The same as data: (hypothesis name, the severity it cannot be excluded at).
    unseen: list[tuple[str, float]] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.cause and self.root_cause is not None:
            self.cause = self.root_cause.value


@dataclass
class Note:
    """Something a person typed about the machine. Kept with the case and shown;
    never scored, so it moves no belief (`investigation.notes`)."""

    id: str  # N1, N2, ... in the order they were added
    text: str
    by: str
    hazards: list[str] = field(default_factory=list)  # hazards its words describe
    at: datetime = field(default_factory=_now)


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
    # "unresolved" is an answer, not a failure: the evidence did not reach the bar,
    # or something in it is explained by none of the hypotheses.
    outcome: Literal["open", "concluded", "unresolved"] = "open"
    unresolved_reason: str | None = None
    transcript: list[str] = field(default_factory=list)
    #: What people typed about the machine. Apart from the ledger: not evidence.
    notes: list[Note] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)

    def belief(self) -> dict[FaultKind, float]:
        """Beliefs of the catalogue hypotheses. `beliefs()` includes written ones."""
        return {h.kind: h.posterior for h in self.hypotheses if h.kind is not None}

    def beliefs(self) -> dict[str, float]:
        return {h.name: h.posterior for h in self.hypotheses}

    def leader(self) -> Hypothesis:
        return max(self.hypotheses, key=lambda h: h.posterior)

    def ranked(self) -> list[Hypothesis]:
        return sorted(self.hypotheses, key=lambda h: h.posterior, reverse=True)

    def surviving(self, floor: float) -> list[Hypothesis]:
        """Hypotheses at or above `floor`. The engine passes its one threshold."""
        return [h for h in self.hypotheses if h.posterior >= floor]
