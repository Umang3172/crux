"""Virtual experiments on what the phone saw and heard.

The same physics the investigation uses, pointed at two new sensors:

* **The camera** samples motion at its frame rate, so it sees shaft orders (1x,
  2x, harmonics, half orders) and nothing as fast as a bearing impact. Each
  shaft-order hypothesis is synthesised *as the camera would sample it*,
  aliasing included, and compared with the measured motion by the same
  log peak-hold correlation (`physics.compare`). The camera cannot tell a
  bearing fault from a healthy machine; it says so instead of guessing.
* **The microphone** samples at audio rates, so with the bearing's geometry
  every hypothesis, impacts included, can be tested on the sound.

Shape cannot separate a healthy machine from an out-of-balance one: both are
a clean 1x. A level can, so a scan is compared with an earlier scan of the same
machine taken when it ran normally, and the *growth* at each order is matched
with what each fault adds over a healthy machine in `physics.signatures`.

These are agreement scores from physics, not beliefs. Beliefs move only in the
investigation engine.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from ..investigation.catalog import CATALOG, EvidenceTest
from ..models import SKF_6205_2RS_JEM, FaultKind, MachineSpec
from ..physics.compare import raw_spectrum_correlation, spectral_correlation
from ..physics.signatures import DEFAULT_HYPOTHESES, Signature, predicted_signature
from ..physics.synth import synthesize
from ..signals.features import estimate_rpm, magnitude_spectrum, peak_near
from .motion import HIGHPASS_HZ

#: The faults a camera can tell apart by shape: they live at shaft orders.
CAMERA_KINDS: tuple[FaultKind, ...] = (
    FaultKind.HEALTHY,
    FaultKind.IMBALANCE,
    FaultKind.MISALIGNMENT,
    FaultKind.LOOSENESS,
)

#: The shaft orders `physics.signatures` uses for these faults.
ORDERS: tuple[float, ...] = (0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0)

#: Spectrum bin for the camera comparison. A 10 s clip resolves 0.1 Hz; 1 Hz
#: bins absorb a few percent of speed error at typical 1x lines (20 to 50 Hz).
CAMERA_BIN_HZ = 1.0

#: Scores this close to the best are not told apart. Agreement scores on clean
#: synthetic tests differ by more than this between a right and a wrong fault
#: (tests/test_lens.py); smaller gaps are within what speed error alone moves.
TIE = 0.05

#: Seed for the virtual experiments, so every score can be recomputed.
SEED = 7

#: Sound: seconds analysed. Five seconds at 48 kHz resolves 0.2 Hz.
SOUND_SECONDS = 5.0

#: A machine record for physics that needs a bearing only for bearing faults.
#: The camera's hypotheses (shaft orders) never read the geometry.
_ANY_BEARING = SKF_6205_2RS_JEM


def seen_at(f_hz: float, fps: float) -> float:
    """Where a line at `f_hz` appears in a capture at `fps`: aliasing folds it back."""
    r = f_hz % fps
    return fps - r if r > fps / 2 else r


@dataclass(frozen=True)
class Line:
    order: float
    true_hz: float
    seen_hz: float
    amp: float  # measured peak at seen_hz, pixels
    clear: bool  # above the drift filter and not on top of another order


def lines(signal: np.ndarray, fps: float, rpm: float) -> list[Line]:
    f, mag = magnitude_spectrum(signal, fps)
    tol = max(2 * (f[1] - f[0]) if len(f) > 1 else 0.5, 0.3)
    fr = rpm / 60.0
    seen = {o: seen_at(o * fr, fps) for o in ORDERS}
    out = []
    for o in ORDERS:
        s = seen[o]
        crowded = any(abs(s - seen[p]) < CAMERA_BIN_HZ for p in ORDERS if p != o)
        clear = s > HIGHPASS_HZ * 1.5 and not crowded
        out.append(Line(o, o * fr, s, peak_near(f, mag, s, tol), clear))
    return out


def refine_speed(signal: np.ndarray, fps: float, rpm: float) -> tuple[float, str]:
    """Order tracking on the motion when 1x is below the camera's limit; else keep `rpm`."""
    if rpm / 60.0 * 1.05 >= fps / 2:
        return rpm, (
            f"1x ({rpm / 60:.1f} Hz) is above what {fps:.0f} fps can see directly "
            f"({fps / 2:.0f} Hz); its alias is used and the speed is taken as given"
        )
    f, mag = magnitude_spectrum(signal, fps)
    est = estimate_rpm(f, mag, rpm)
    if est.from_signal:
        return est.rpm, f"speed read from the motion: {est.rpm:.0f} rpm (given {rpm:.0f})"
    return rpm, f"speed taken as given ({est.note})"


@dataclass(frozen=True)
class Agreement:
    kind: FaultKind
    score: float  # 0..1, agreement of the virtual experiment with the measurement
    note: str = ""


def _tones_only(sig: Signature) -> Signature:
    return Signature(sig.kind, tones=sig.tones, noise=0.02, description=sig.description)


def camera_experiments(signal: np.ndarray, fps: float, rpm: float) -> list[Agreement]:
    """Each shaft-order fault, sampled as this camera would see it, against the motion."""
    machine = MachineSpec("lens", "scanned machine", _ANY_BEARING, rpm, fps)
    duration = len(signal) / fps
    f_max = 0.98 * fps / 2
    out = []
    for kind in CAMERA_KINDS:
        sim = synthesize(_tones_only(predicted_signature(kind, machine, rpm)), fps, duration, SEED)
        score = raw_spectrum_correlation(signal, sim, fps, f_max=f_max, bin_hz=CAMERA_BIN_HZ)
        out.append(Agreement(kind, score))
    return sorted(out, key=lambda a: -a.score)


def consistent(scores: list[Agreement]) -> list[FaultKind]:
    """The faults whose agreement is within TIE of the best."""
    if not scores:
        return []
    best = max(a.score for a in scores)
    return [a.kind for a in scores if a.score >= best - TIE]


def _added(kind: FaultKind, rpm: float) -> np.ndarray:
    """What a fault adds at each order over a healthy machine, from its signature."""
    machine = MachineSpec("lens", "scanned machine", _ANY_BEARING, rpm)
    fr = rpm / 60.0

    def amps(k: FaultKind) -> np.ndarray:
        tones = predicted_signature(k, machine, rpm).tones
        return np.array(
            [sum(t.amp for t in tones if abs(t.freq_hz - o * fr) < 1e-6) for o in ORDERS]
        )

    return np.clip(amps(kind) - amps(FaultKind.HEALTHY), 0.0, None)


#: A shaft line counts as grown only once it has at least doubled since the
#: normal scan: the same doubling the watcher needs before it alarms
#: (docs/FORECAST.md), so camera noise between two scans never names a fault.
GROWN = 2.0


@dataclass
class Change:
    growth: dict[float, float]  # order -> this scan / normal scan, box-scaled
    scores: list[Agreement] = field(default_factory=list)
    note: str = ""


def against_normal(
    now: list[Line], normal: list[Line], scale_now: float, scale_normal: float, rpm: float
) -> Change:
    """How the motion grew since a normal scan, matched with what each fault adds.

    Amplitudes are divided by the size of the machine's box in each scan, so a
    phone held a little closer does not look like a worse machine.
    """
    a = np.array([ln.amp / scale_now for ln in now])
    b = np.array([ln.amp / scale_normal for ln in normal])
    use = np.array([x.clear and y.clear for x, y in zip(now, normal, strict=True)])
    growth = {
        ln.order: float(x / y) if y > 0 else float("inf")
        for ln, x, y in zip(now, a, b, strict=True)
    }
    added = np.where(a >= GROWN * b, a - b, 0.0) * use
    if added.sum() <= 0:
        return Change(growth, [], "no shaft line has doubled since the normal scan")
    out = []
    for kind in (FaultKind.IMBALANCE, FaultKind.MISALIGNMENT, FaultKind.LOOSENESS):
        p = _added(kind, rpm) * use
        cos = float(added @ p / (np.linalg.norm(added) * np.linalg.norm(p) + 1e-12))
        out.append(Agreement(kind, max(0.0, cos)))
    return Change(growth, sorted(out, key=lambda x: -x.score))


#: Bearings whose geometry is on file, by the part number a nameplate or label shows.
#: A generic 6205 is read with the SKF 6205-2RS JEM geometry (9 balls of 7.94 mm),
#: the CWRU reference; other makers' 6205s differ slightly, which the 2% slip
#: window absorbs. Anything else is TBD until its geometry is entered.
KNOWN_BEARINGS = {"6205": SKF_6205_2RS_JEM}


def bearing_for(text: str) -> MachineSpec | None:
    for code, geometry in KNOWN_BEARINGS.items():
        if code in text.replace(" ", ""):
            return MachineSpec("lens", "scanned machine", geometry, 0.0)
    return None


def sound_experiments(
    audio: np.ndarray, fs: float, rpm: float, bearing_text: str = ""
) -> tuple[list[Agreement], str]:
    """Every hypothesis against the sound, when the bearing is known; else why not."""
    spec = bearing_for(bearing_text)
    if spec is None:
        return [], (
            "bearing model not known: the sound cannot be checked for bearing faults "
            "until it is entered"
        )
    machine = MachineSpec("lens", "scanned machine", spec.bearing, rpm, fs)
    x = np.asarray(audio, dtype=float)[: int(fs * SOUND_SECONDS)]
    duration = len(x) / fs
    out = []
    for kind in DEFAULT_HYPOTHESES:
        sim = synthesize(predicted_signature(kind, machine, rpm), fs, duration, SEED)
        out.append(Agreement(kind, spectral_correlation(x, sim, fs)))
    note = (
        f"bearing read as {spec.bearing.label}. Phone microphones hear little below "
        "about 200 Hz, so the sound speaks mainly to bearing faults"
    )
    return sorted(out, key=lambda a: -a.score), note


def next_check(kinds: list[FaultKind]) -> EvidenceTest | None:
    """The catalog measurement that best separates the faults still standing.

    Same rule the investigation uses to rank tests (prediction spread over the
    test's noise), without beliefs: every survivor counts the same.
    """
    if len(kinds) < 2:
        return None
    best, best_key = None, None
    for test in CATALOG:
        preds = [test.predict(k) for k in kinds]
        if any(p is None for p in preds):
            continue
        spread = (max(preds) - min(preds)) / test.sigma
        key = (spread, -test.effort_min)
        if best_key is None or key > best_key:
            best, best_key = test, key
    return best
