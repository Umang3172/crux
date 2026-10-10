"""Open cases, where they are kept, and the one door a reading comes in by.

A case wraps an `Investigation` with what the tool layer needs on top of it:
the measurement requests and their readings, suspects a model has written, and
the model's own narration, which is kept apart from the evidence ledger.

`record_measurement` is deliberately not an agent tool. A reading comes from a
technician, a sensor or the replay rig; a language model never supplies one.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Literal, Protocol

from ..investigation.engine import Investigation, TestChoice
from ..models import MachineSpec, Observation
from .contract import SuspectSpec

#: Answers a requested test id with a reading (a number a person would report, or
#: the capture itself), or None when it cannot. The replay rig and a recorded run
#: are two; in the field the reading arrives later, from a person or a sensor.
AnswerSource = Callable[[str], float | Observation | None]


class CaseNotFound(LookupError):
    """No open case has this id."""


@dataclass
class MeasurementRequest:
    id: str
    test_id: str
    status: Literal["waiting", "answered", "unanswerable"] = "waiting"
    reading: float | None = None
    collected_by: str | None = None
    note: str = ""


@dataclass
class WrittenSuspect:
    spec: SuspectSpec
    status: Literal["tested", "pending_experiments", "refused"]
    reasons: list[str]


@dataclass
class Case:
    investigation: Investigation
    answer_source: AnswerSource | None = None
    requests: list[MeasurementRequest] = field(default_factory=list)
    written_suspects: list[WrittenSuspect] = field(default_factory=list)
    narration: list[str] = field(default_factory=list)
    # What the investigator gave as its reason when it closed the case without a
    # verdict. Its own words, like the narration: the engine's reason is the
    # state's `unresolved_reason`.
    investigator_reason: str = ""
    # The physics' latest pick, and the engine's own words for it. A request must
    # name this test; the words go into the transcript once, when it is made.
    chosen: TestChoice | None = None
    chosen_lines: list[str] = field(default_factory=list)

    @property
    def id(self) -> str:
        return self.investigation.state.id

    @property
    def status(self) -> Literal["open", "concluded", "unresolved"]:
        """Read from the engine, which is the only thing that closes a case."""
        return self.investigation.state.outcome

    def request(self, request_id: str) -> MeasurementRequest:
        for req in self.requests:
            if req.id == request_id:
                return req
        raise KeyError(f"case {self.id} has no request {request_id}")


class CaseStore(Protocol):
    """Where cases live between tool calls.

    The in-memory store is lost on restart and is not shared between Cloud Run
    instances; a database-backed store replaces it there behind this interface.
    """

    def get(self, case_id: str) -> Case: ...

    def put(self, case: Case) -> None: ...


class InMemoryCaseStore:
    def __init__(self) -> None:
        self._cases: dict[str, Case] = {}

    def get(self, case_id: str) -> Case:
        try:
            return self._cases[case_id]
        except KeyError:
            raise CaseNotFound(f"no case with id {case_id!r}") from None

    def put(self, case: Case) -> None:
        self._cases[case.id] = case


def open_case(
    store: CaseStore,
    machine: MachineSpec,
    observation: Observation,
    answer_source: AnswerSource | None = None,
    normal: Sequence[Observation] = (),
) -> Case:
    """Open a case on a capture and record the first look. Not an agent tool:
    the watcher, the replay button or the API opens cases. `normal` holds
    healthy captures of the same machine, when there are any: the case is then
    scored on the change from them."""
    investigation = Investigation(machine, observation, normal=normal)
    investigation.observe()
    case = Case(investigation, answer_source=answer_source)
    store.put(case)
    return case


def record_measurement(
    store: CaseStore,
    case_id: str,
    request_id: str,
    reading: float | Observation,
    collected_by: str = "technician",
) -> MeasurementRequest:
    """Hand a requested reading to the engine. The only way a reading gets in.

    A number is what a person read off. A capture is handed over whole: the
    engine reads the test's feature from it and scores it at the capture's own
    length and noise, against the machine's own normal when the case has one.
    """
    case = store.get(case_id)
    req = case.request(request_id)
    if req.status != "waiting":
        raise ValueError(f"{request_id} is {req.status}, not waiting for a reading")
    if isinstance(reading, Observation):
        value = case.investigation.apply_capture(req.test_id, reading, collected_by=collected_by)
    else:
        if not math.isfinite(reading):
            raise ValueError("a reading must be a finite number")
        value = float(reading)
        case.investigation.apply_outcome(req.test_id, value, collected_by=collected_by)
    req.status = "answered"
    req.reading = value
    req.collected_by = collected_by
    store.put(case)
    return req


def mark_unanswerable(
    store: CaseStore, case_id: str, request_id: str, why: str
) -> MeasurementRequest:
    """Close a request that nobody can answer, rather than inventing a reading."""
    case = store.get(case_id)
    req = case.request(request_id)
    if req.status != "waiting":
        raise ValueError(f"{request_id} is {req.status}, not waiting for a reading")
    req.status = "unanswerable"
    req.note = why
    case.investigation.could_not_take(req.test_id, why)
    store.put(case)
    return req
