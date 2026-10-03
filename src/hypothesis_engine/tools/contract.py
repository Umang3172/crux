"""Typed inputs and outputs of the agent tools.

Everything here is plain data, so the same models can be handed to a language
model as JSON and checked on the way back in. Suspects are written in multiples
of shaft speed rather than in Hz, so one description holds at any running speed.

Output models may report beliefs; input models never carry one. The tests in
`tests/test_tools.py` hold that line.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

# ----------------------------------------------------------------- inputs


class ToneSpec(BaseModel):
    """A sinusoid locked to shaft speed, such as the 2x peak of misalignment."""

    order: float = Field(gt=0, description="Frequency as a multiple of shaft speed, e.g. 2.0")
    relative_amplitude: float = Field(
        gt=0, description="Height relative to the normal 1x running tone (1.0 = the same height)"
    )


class ImpactSpec(BaseModel):
    """Repeated impacts that ring a structural resonance, such as a spalled race."""

    rate_order: float = Field(gt=0, description="Impacts per shaft revolution, e.g. 3.58")
    relative_amplitude: float = Field(gt=0, description="Impact strength relative to the 1x tone")
    modulation_order: float | None = Field(
        default=None,
        gt=0,
        description="Amplitude modulation as a multiple of shaft speed, for a defect that "
        "moves in and out of the load zone; leave empty if it does not",
    )
    resonance_hz: float | None = Field(
        default=None,
        gt=0,
        description="The resonance the impacts excite; leave empty for the machine's default",
    )


class SuspectSpec(BaseModel):
    """A possible cause that is not in the catalogue, written as the vibration it predicts."""

    name: str = Field(
        pattern=r"^[a-z][a-z0-9_]{2,39}$", description="Short snake_case name, e.g. bent_shaft"
    )
    description: str = Field(
        min_length=10,
        max_length=400,
        description="What physical fault this is, and why it would vibrate this way",
    )
    tones: list[ToneSpec] = Field(default_factory=list, max_length=12)
    impacts: list[ImpactSpec] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def _predicts_something(self) -> SuspectSpec:
        if not self.tones and not self.impacts:
            raise ValueError("a suspect must predict at least one tone or one impact train")
        return self


# ----------------------------------------------------------------- outputs


class SuspectView(BaseModel):
    name: str
    label: str
    origin: Literal["catalogue", "written"]
    status: Literal["live", "rejected", "untested", "refused"]
    belief: float | None = Field(
        description="Set by the physics. None for a written suspect it has not simulated"
    )
    simulation_match: float | None = None


class EvidenceView(BaseModel):
    id: str
    statement: str
    value: float | str | None
    unit: str
    source: str


class RequestView(BaseModel):
    request_id: str
    test_id: str
    test_name: str
    status: Literal["waiting", "answered", "unanswerable"]
    reading: float | None = None
    collected_by: str | None = None
    procedure: list[str]
    coach_prompt: str
    effort_min: float
    downtime: str


class CaseView(BaseModel):
    case_id: str
    machine: str
    rpm: float
    status: Literal["open", "concluded", "unresolved"]
    leader: str
    leader_belief: float
    conclude_at: float
    blockers: list[str] = Field(
        default_factory=list, description="Why the case cannot conclude yet, from the physics"
    )
    unresolved_reason: str | None = None
    suspects: list[SuspectView]
    evidence: list[EvidenceView]
    requests: list[RequestView]
    narration: list[str]
    transcript: list[str]


class Features(BaseModel):
    rpm: float
    shaft_hz: float
    fault_frequencies_hz: dict[str, float]
    observations: dict[str, float]


class ExperimentResult(BaseModel):
    ran: bool
    detail: str
    simulation_match: dict[str, float]
    rejected: list[str]
    leader: str
    leader_belief: float


class NextTest(BaseModel):
    available: bool
    detail: str
    test_id: str | None = None
    test_name: str | None = None
    expected_info_gain_nats: float | None = None
    gain_per_minute: float | None = None
    effort_min: float | None = None
    downtime: str | None = None


class RequestResult(BaseModel):
    ok: bool
    detail: str
    request: RequestView | None = None


class SuspectReview(BaseModel):
    name: str
    status: Literal["tested", "pending_experiments", "refused"]
    reasons: list[str]


class ConcludeResult(BaseModel):
    ok: bool
    detail: str
    root_cause: str | None = None
    confidence: float | None = None
    recommended_action: str | None = None
    what_would_change_my_mind: str | None = None
    evidence_ids: list[str] = Field(default_factory=list)


class Ack(BaseModel):
    ok: bool
    detail: str
