"""Jev adapter: typed, calibrated decisions during a coached measurement.

Why a second model at all: the coach has to decide something every second
("is the sensor on the housing? is the speed steady? can we stop recording?").
Those are classifications, not prose, and calling a large model for each one is
slow and expensive. Jev returns a typed answer with a probability.

That difference has not been measured here, and nothing in the product calls
this adapter yet: both are open work in docs/TASKS.md.

Install with the `jev` extra:  uv pip install -e ".[jev]"
"""

from __future__ import annotations

from .protocols import GateVerdict

STEP_STATES = {
    "placed": "The sensor is on the machine but the capture has not started",
    "steady": "The sensor is placed and the speed is steady, recording can run",
    "capturing": "A capture is in progress and going well",
    "done": "The capture finished and looks usable",
    "retake": "Something was wrong: the placement, the speed, or the hold",
    "unclear": "The camera cannot see enough to judge",
}


class JevGate:
    name = "jev"

    def __init__(self) -> None:
        from langchain_typesafe import Choice, Noul, TypeSafeClassifier  # type: ignore

        self._classifier = TypeSafeClassifier(
            questions={
                "step_state": Choice(
                    instructions="What is the state of this measurement right now?",
                    criteria=STEP_STATES,
                ),
                "escalate": Noul(
                    instructions="Should a supervisor be called before continuing?",
                ),
            }
        )

    def check(self, scene: str, expected: str) -> GateVerdict:
        # The classifier takes the state as a string; the questions were declared
        # once, above, so every call returns the same typed shape.
        result = self._classifier.invoke(f"Expected: {expected}\nCamera sees: {scene}")
        choice = result.choices["step_state"]
        escalate = result.nouls["escalate"]
        say = {
            "placed": "Hold it flat on the housing.",
            "steady": "Good. Hold still for ten seconds.",
            "capturing": "Keep holding.",
            "done": "Captured. Sending it to the investigation.",
            "retake": "Let us take that again.",
            "unclear": "I cannot see the sensor. Bring it into view.",
        }[choice.choice]
        return GateVerdict(
            step_state=choice.choice,
            confidence=float(getattr(choice, "confidence", 0.0) or 0.0),
            say=say,
            escalate=bool(getattr(escalate, "noul", False)),
        )
