"""What each hypothesis should look like in the spectrum.

A Signature is a small, explicit description of a predicted vibration signal:
sinusoidal components (shaft orders) plus optional impact trains (bearing
defects). `physics.synth` turns a Signature into a waveform, and
`physics.compare` scores that waveform against the real one.

Amplitudes are relative, not absolute: comparison is scale-invariant, so the
numbers below encode *shape*, which is what distinguishes the faults.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..models import FaultKind, MachineSpec
from .frequencies import fault_frequencies, shaft_hz


@dataclass(frozen=True)
class Tone:
    """A sinusoidal component at `freq_hz` with relative amplitude `amp`."""

    freq_hz: float
    amp: float
    label: str = ""


@dataclass(frozen=True)
class ImpactTrain:
    """Repetitive impacts that ring a structural resonance.

    This is how a spalled bearing race shows up: a train of impulses at the fault
    frequency, each exciting a high-frequency resonance that decays. Envelope
    analysis is the standard way to recover `rate_hz` from the raw signal.
    """

    rate_hz: float
    amp: float
    resonance_hz: float = 3_000.0
    damping: float = 800.0
    modulation_hz: float | None = None  # sidebands, e.g. inner race modulated by 1x
    label: str = ""


@dataclass(frozen=True)
class Signature:
    kind: FaultKind
    tones: tuple[Tone, ...] = field(default_factory=tuple)
    impacts: tuple[ImpactTrain, ...] = field(default_factory=tuple)
    noise: float = 0.08
    description: str = ""


def predicted_signature(
    kind: FaultKind,
    machine: MachineSpec,
    rpm: float,
    severity: float = 1.0,
) -> Signature:
    """The physics engine's prediction for one hypothesis at this speed.

    `severity` scales the fault component only; the baseline running tones stay
    put, so a mild fault looks like a small peak on a normal machine.
    """
    fr = shaft_hz(rpm)
    ff = fault_frequencies(machine.bearing, rpm)
    base = (Tone(fr, 0.25, "1x baseline"),)

    if kind is FaultKind.HEALTHY:
        return Signature(
            kind,
            tones=base + (Tone(2 * fr, 0.06, "2x"),),
            noise=0.10,
            description="Running tones only: a small 1x with little else.",
        )

    if kind is FaultKind.IMBALANCE:
        return Signature(
            kind,
            tones=(
                Tone(fr, 0.25 + 1.00 * severity, "1x dominant"),
                Tone(2 * fr, 0.12 * severity, "2x small"),
            ),
            noise=0.08,
            description="A single dominant peak at 1x that grows with speed.",
        )

    if kind is FaultKind.MISALIGNMENT:
        return Signature(
            kind,
            tones=(
                Tone(fr, 0.25 + 0.55 * severity, "1x"),
                Tone(2 * fr, 1.00 * severity, "2x dominant"),
                Tone(3 * fr, 0.35 * severity, "3x"),
            ),
            noise=0.08,
            description="2x dominates 1x, usually with some 3x.",
        )

    if kind is FaultKind.LOOSENESS:
        return Signature(
            kind,
            tones=(
                Tone(0.5 * fr, 0.30 * severity, "0.5x sub-harmonic"),
                Tone(fr, 0.25 + 0.70 * severity, "1x"),
                Tone(1.5 * fr, 0.25 * severity, "1.5x"),
                Tone(2 * fr, 0.50 * severity, "2x"),
                Tone(3 * fr, 0.45 * severity, "3x"),
                Tone(4 * fr, 0.30 * severity, "4x"),
                Tone(5 * fr, 0.22 * severity, "5x"),
            ),
            noise=0.12,
            description="A long run of harmonics plus half-order peaks.",
        )

    if kind is FaultKind.OUTER_RACE:
        return Signature(
            kind,
            tones=base,
            impacts=(
                ImpactTrain(
                    rate_hz=ff.bpfo,
                    amp=1.00 * severity,
                    resonance_hz=3_000.0,
                    damping=800.0,
                    label="BPFO impacts",
                ),
            ),
            noise=0.10,
            description="Impacts at BPFO; the outer race is stationary, so no 1x sidebands.",
        )

    if kind is FaultKind.INNER_RACE:
        return Signature(
            kind,
            tones=base,
            impacts=(
                ImpactTrain(
                    rate_hz=ff.bpfi,
                    amp=1.00 * severity,
                    resonance_hz=3_000.0,
                    damping=800.0,
                    modulation_hz=fr,
                    label="BPFI impacts, modulated by shaft speed",
                ),
            ),
            noise=0.10,
            description="Impacts at BPFI with 1x sidebands, because the defect moves in and out of load.",
        )

    raise ValueError(f"No predicted signature for {kind}")


#: Hypotheses the engine considers by default. Healthy is included so that
#: "nothing is wrong" can win, which matters for false-alarm rate.
DEFAULT_HYPOTHESES: tuple[FaultKind, ...] = (
    FaultKind.IMBALANCE,
    FaultKind.MISALIGNMENT,
    FaultKind.LOOSENESS,
    FaultKind.OUTER_RACE,
    FaultKind.INNER_RACE,
    FaultKind.HEALTHY,
)
