"""A synthetic bearing life: the demo pump, run from new until its bearing fails.

The deployed image ships no dataset, so without this the path from the
watcher's alarm to an investigation and a repair ticket could only be walked on
a machine that holds a recorded run. This is a stand-in life for that path. It
is made by the same signal model as the rig (`physics.synth`), it is labelled
synthetic wherever it is shown, and it is never part of an evaluation: the
engine is run here on the output of its own signal model (see `data/rig.py`).

The pump is given a normal of its own, as a real machine has: a 2x taller than
its 1x, harmonics to 4x, and noise that is quiet near the shaft lines and loud
above 1 kHz. Against the textbook machine that normal alone reads as
misalignment, so the life also shows why a case is scored against a machine's
own healthy captures (`physics.normal`).

Every number below is a choice for a demonstration, not a measurement of any
machine.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from scipy.signal import butter, sosfilt

from ..models import SKF_6205_2RS_JEM, FaultKind, MachineSpec, Observation
from ..physics.frequencies import shaft_hz
from ..physics.signatures import Signature, Tone, predicted_signature
from ..physics.synth import synthesize

#: The id the life is served under, as machine and as part: one bearing is watched.
DEMO_ID = "demo/pump-2"

DEMO_PUMP = MachineSpec(
    machine_id=DEMO_ID,
    name="Chilled-water pump 2 (synthetic)",
    bearing=SKF_6205_2RS_JEM,
    nominal_rpm=1798.0,
    sample_rate_hz=12_000.0,
    notes="A physics model of a pump, not a recording",
)

#: A two-second snapshot every ten minutes, the cadence of the NASA IMS
#: run-to-failure test: a life of thirty hours.
SNAPSHOTS = 180
SNAPSHOT_S = 2.0
INTERVAL_MIN = 10.0

#: The pump's own running tones, by shaft order: not the textbook's 0.25 and 0.06.
OWN_TONES = {1.0: 0.25, 2.0: 0.40, 3.0: 0.15, 4.0: 0.08}

#: Broadband noise, and where it starts to dominate.
NOISE = 0.15
NOISE_CORNER_HZ = 1_000.0

#: The outer race starts to spall at this snapshot and the damage grows by a
#: fixed factor from each snapshot to the next: exponential growth, the usual
#: shape once a defect spreads.
ONSET = 100
FIRST_STRENGTH = 0.05
LAST_STRENGTH = 16.0

SEED = 20_260


def strength(index: int) -> float:
    """Outer-race fault strength at a snapshot, in the signature model's units."""
    if index < ONSET:
        return 0.0
    span = SNAPSHOTS - 1 - ONSET
    rate = math.log(LAST_STRENGTH / FIRST_STRENGTH) / span
    return FIRST_STRENGTH * math.exp(rate * (index - ONSET))


@lru_cache(maxsize=SNAPSHOTS)
def waveform(index: int) -> np.ndarray:
    """The pump's vibration in one snapshot. The same snapshot is always the same capture."""
    if not 0 <= index < SNAPSHOTS:
        raise IndexError(f"the demo life has snapshots 0 to {SNAPSHOTS - 1}")
    fs, rpm = DEMO_PUMP.sample_rate_hz, DEMO_PUMP.nominal_rpm
    fr = shaft_hz(rpm)
    worn = strength(index)
    impacts = ()
    if worn > 0:
        impacts = predicted_signature(FaultKind.OUTER_RACE, DEMO_PUMP, rpm, severity=worn).impacts
    own = Signature(None, tuple(Tone(o * fr, a) for o, a in OWN_TONES.items()), impacts, noise=0.0)
    x = synthesize(own, fs, SNAPSHOT_S, seed=SEED + index)
    rng = np.random.default_rng(SEED + 10_000 + index)
    hiss = rng.normal(0.0, NOISE, len(x))
    high = sosfilt(butter(1, NOISE_CORNER_HZ, btype="highpass", fs=fs, output="sos"), hiss)
    x = x + 1.3 * high + rng.normal(0.0, 0.08 * NOISE, len(x))
    x.setflags(write=False)
    return x


def observation(index: int) -> Observation:
    """One snapshot of the life as an investigation input."""
    return Observation(
        machine_id=DEMO_ID,
        waveform=waveform(index),
        sample_rate_hz=DEMO_PUMP.sample_rate_hz,
        rpm=DEMO_PUMP.nominal_rpm,
        source=f"synthetic:{DEMO_ID}/snapshot-{index + 1}",
    )


@dataclass(frozen=True)
class SyntheticRun:
    """The life in the shape the forecaster reads a recorded run in
    (`forecast.runs.Run`), with snapshots made on demand, not read from files."""

    run_id: str = DEMO_ID
    source: str = "demo"
    times_min: tuple[float, ...] = tuple(i * INTERVAL_MIN for i in range(SNAPSHOTS))
    fs: float = DEMO_PUMP.sample_rate_hz
    channel: int = 0
    failed: bool = True
    condition: str = "1798 rpm"
    failure_mode: str = "outer race"

    def __len__(self) -> int:
        return len(self.times_min)

    def load(self, i: int) -> np.ndarray:
        x = waveform(i)
        return x - float(np.mean(x))


def run() -> SyntheticRun:
    return SyntheticRun()
