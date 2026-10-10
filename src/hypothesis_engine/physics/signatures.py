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

#: Height of the normal 1x running tone every signature starts from. Amplitudes
#: here are relative, so this fixes the unit the others are measured in.
BASELINE_1X = 0.25

#: Height of the normal 2x running tone. A machine keeps it when it develops a
#: fault, so every signature carries it: a fault adds to the running tones, it
#: does not replace them.
BASELINE_2X = 0.06


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
    kind: FaultKind | None  # None for a suspect written outside the catalogue
    tones: tuple[Tone, ...] = field(default_factory=tuple)
    impacts: tuple[ImpactTrain, ...] = field(default_factory=tuple)
    noise: float = 0.08
    description: str = ""


@dataclass(frozen=True)
class OrderSuspect:
    """A cause outside the catalogue, written as the vibration it would produce.

    Frequencies are multiples of shaft speed and heights are relative to the
    normal 1x running tone (4.0 = four times as tall), so one description holds
    at any speed. It carries physics only; the engine works out the belief.

    tones:   (order, relative height)
    impacts: (impacts per revolution, relative strength, modulation order or
             None, resonance in Hz or None for the default)
    """

    name: str
    description: str
    tones: tuple[tuple[float, float], ...] = ()
    impacts: tuple[tuple[float, float, float | None, float | None], ...] = ()


def signature_from_orders(suspect: OrderSuspect, rpm: float, severity: float = 1.0) -> Signature:
    """Render a written suspect as a Signature, scaled like the catalogue's.

    As in `predicted_signature`, `severity` scales the fault and leaves the
    normal running 1x where it is.
    """
    fr = shaft_hz(rpm)
    tones: list[Tone] = []
    running = {1.0: BASELINE_1X, 2.0: BASELINE_2X}
    for order, height in running.items():
        if not any(abs(written - order) < 1e-9 for written, _ in suspect.tones):
            tones.append(Tone(order * fr, height, f"{order:g}x baseline"))
    for order, height in suspect.tones:
        base = next((b for o, b in running.items() if abs(order - o) < 1e-9), 0.0)
        amp = base + (height * BASELINE_1X - base) * severity
        tones.append(Tone(order * fr, amp, f"{order:g}x"))
    impacts = []
    for rate_order, strength, modulation_order, resonance_hz in suspect.impacts:
        extra = {} if resonance_hz is None else {"resonance_hz": resonance_hz}
        impacts.append(
            ImpactTrain(
                rate_hz=rate_order * fr,
                amp=strength * BASELINE_1X * severity,
                modulation_hz=None if modulation_order is None else modulation_order * fr,
                label=f"impacts at {rate_order:g}x",
                **extra,
            )
        )
    return Signature(
        None, tuple(tones), tuple(impacts), noise=0.10, description=suspect.description
    )


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
    base = (Tone(fr, BASELINE_1X, "1x baseline"), Tone(2 * fr, BASELINE_2X, "2x baseline"))

    if kind is FaultKind.HEALTHY:
        return Signature(
            kind,
            tones=base,
            noise=0.10,
            description="Running tones only: a small 1x with little else.",
        )

    if kind is FaultKind.IMBALANCE:
        return Signature(
            kind,
            tones=(
                Tone(fr, BASELINE_1X + 1.00 * severity, "1x dominant"),
                Tone(2 * fr, BASELINE_2X + 0.12 * severity, "2x small"),
            ),
            noise=0.08,
            description="A single dominant peak at 1x that grows with speed.",
        )

    if kind is FaultKind.MISALIGNMENT:
        return Signature(
            kind,
            tones=(
                Tone(fr, BASELINE_1X + 0.55 * severity, "1x"),
                Tone(2 * fr, BASELINE_2X + 1.00 * severity, "2x dominant"),
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
                Tone(fr, BASELINE_1X + 0.70 * severity, "1x"),
                Tone(1.5 * fr, 0.25 * severity, "1.5x"),
                Tone(2 * fr, BASELINE_2X + 0.50 * severity, "2x"),
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
