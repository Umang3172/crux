"""The tests the agent can ask for, and what each hypothesis predicts they show.

This is the heart of active diagnosis. Each test declares:

* the single feature it returns,
* what each hypothesis predicts for that feature (physics, see docs/DOMAIN.md),
* how noisy the measurement is,
* what it costs in technician-minutes and downtime,
* the procedure the phone coach walks a person through.

The engine then picks the test with the highest expected information gain per
minute. Nothing here is learned; all of it is inspectable and arguable, which is
what a reliability engineer needs.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..models import FaultKind


@dataclass(frozen=True)
class EvidenceTest:
    id: str
    name: str
    feature: str
    sigma: float  # measurement noise, same units as the predictions
    effort_min: float
    downtime: str
    procedure: tuple[str, ...]
    predictions: dict[FaultKind, float] = field(default_factory=dict)
    coach_prompt: str = ""

    def predict(self, kind: FaultKind) -> float | None:
        return self.predictions.get(kind)


# Predicted feature values are relative amplitudes (to 1x) or ratios. They are
# first-pass priors from standard vibration diagnosis and are recalibrated
# against the rig in week 2 — see docs/TASKS.md.
CATALOG: tuple[EvidenceTest, ...] = (
    EvidenceTest(
        id="vib_10s",
        name="10 s vibration capture at the drive end",
        feature="ratio_2x_1x",
        sigma=0.18,
        effort_min=2.0,
        downtime="none",
        coach_prompt="Place the sensor flat on the drive-end housing and hold for ten seconds at steady speed.",
        procedure=(
            "Magnet-mount the accelerometer on the bare drive-end housing",
            "Wait for the speed to settle at the normal running point",
            "Hold still for ten seconds while it records",
        ),
        predictions={
            FaultKind.IMBALANCE: 0.12,
            FaultKind.MISALIGNMENT: 1.60,
            FaultKind.LOOSENESS: 0.65,
            FaultKind.OUTER_RACE: 0.30,
            FaultKind.INNER_RACE: 0.30,
            FaultKind.HEALTHY: 0.25,
        },
    ),
    EvidenceTest(
        id="envelope",
        name="Envelope capture around the bearing resonance",
        # log10(BPFO / BPFI) in the envelope. Positive means the outer race,
        # negative the inner race, near zero means the bearing is not the story.
        # Scale-free on purpose: raw envelope height moves with load and speed.
        feature="env_contrast",
        sigma=0.28,
        effort_min=3.0,
        downtime="none",
        coach_prompt="Same spot, but hold for thirty seconds so we can resolve the envelope.",
        procedure=(
            "Keep the sensor on the drive-end housing",
            "Record for thirty seconds without moving it",
            "Note the speed at the start and the end",
        ),
        predictions={
            FaultKind.IMBALANCE: 0.00,
            FaultKind.MISALIGNMENT: 0.00,
            FaultKind.LOOSENESS: 0.05,
            FaultKind.OUTER_RACE: 1.20,
            FaultKind.INNER_RACE: -0.90,
            FaultKind.HEALTHY: 0.00,
        },
    ),
    EvidenceTest(
        id="half_order",
        name="Half-order check (looseness screen)",
        feature="amp_half_x",
        sigma=0.09,
        effort_min=2.0,
        downtime="none",
        coach_prompt="One more ten-second capture, this time on the mounting foot.",
        procedure=(
            "Move the sensor to the mounting foot, on bare metal",
            "Record for ten seconds at the same speed",
        ),
        predictions={
            FaultKind.IMBALANCE: 0.03,
            FaultKind.MISALIGNMENT: 0.05,
            FaultKind.LOOSENESS: 0.34,
            FaultKind.OUTER_RACE: 0.06,
            FaultKind.INNER_RACE: 0.07,
            FaultKind.HEALTHY: 0.02,
        },
    ),
    EvidenceTest(
        id="temperature",
        name="Housing temperature above baseline",
        feature="temp_rise_c",
        sigma=3.0,
        effort_min=5.0,
        downtime="none",
        coach_prompt="Point the thermometer at the bearing housing, about ten centimetres away.",
        procedure=(
            "Aim at the bearing housing, not the motor casing",
            "Hold ten centimetres away and read the steady value",
            "Read the ambient temperature as well",
        ),
        predictions={
            FaultKind.IMBALANCE: 2.0,
            FaultKind.MISALIGNMENT: 6.0,
            FaultKind.LOOSENESS: 3.0,
            FaultKind.OUTER_RACE: 12.0,
            FaultKind.INNER_RACE: 13.0,
            FaultKind.HEALTHY: 1.0,
        },
    ),
    EvidenceTest(
        id="coast_down",
        name="Coast-down capture",
        feature="speed_sensitivity",
        sigma=0.22,
        effort_min=10.0,
        downtime="brief stop",
        coach_prompt="Stop the machine and record while it coasts to rest.",
        procedure=(
            "Tell the operator you are stopping the machine",
            "Start recording, then cut power and let it coast",
            "Keep recording until the shaft stops",
        ),
        predictions={
            # How strongly the dominant peak tracks speed squared.
            FaultKind.IMBALANCE: 1.90,
            FaultKind.MISALIGNMENT: 1.20,
            FaultKind.LOOSENESS: 0.80,
            FaultKind.OUTER_RACE: 1.00,
            FaultKind.INNER_RACE: 1.00,
            FaultKind.HEALTHY: 1.00,
        },
    ),
)

BY_ID = {t.id: t for t in CATALOG}
