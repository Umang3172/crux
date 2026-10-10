"""Public recordings with a microphone, read into what the sound check needs.

Each loader returns a `Recording`: the sound, its sample rate, the shaft speed
and where that speed came from, and the cause as the dataset labels it. Nothing
here downloads anything: a person puts the files under `data/` (docs/LENS.md,
"Data for testing"), and a missing folder simply yields no recordings.

* **MaFaulDa** (UFRJ): one CSV per recording, 8 columns, 250,000 rows, no header.
  The shaft speed is read from the tachometer column of the same file.
* **Jung et al. 2023** (KAIST): MATLAB files holding a `Signal` struct; the five
  microphone recordings are all at 3,010 rpm, stated in the article, with no
  tachometer channel.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ..forecast.runs import DATA_ROOT
from ..models import FaultKind

MAFAULDA_DIR = DATA_ROOT / "mafaulda"
JUNG_DIR = DATA_ROOT / "jung2023" / "acoustic"

#: Column order on the MaFaulDa page ("Data structure"), read 10 Oct 2026.
MAFAULDA_COLUMNS = (
    "tachometer",
    "underhang_axial",
    "underhang_radial",
    "underhang_tangential",
    "overhang_axial",
    "overhang_radial",
    "overhang_tangential",
    "microphone",
)

#: The rate the MaFaulDa page states ("50 kHz sampling rate during 5 s"). The
#: same page lists NI 9234 modules at 51.2 kHz and the file names are multiples
#: of 51,200 / 250,000 Hz (docs/LENS.md). Every ratio to shaft speed is the same
#: either way, because the speed is read from the same file's tachometer.
MAFAULDA_FS = 50_000.0

#: The MaFaulDa page names no bearing model; this is its key in `lens.bearings`.
MAFAULDA_BEARING = "MaFaulDa"

#: Jung et al. 2023, Data in Brief 48:109049: "3010 rpm", bearing "NSK 6205 DDU".
JUNG_RPM = 3010.0
JUNG_BEARING = "NSK 6205 DDU"

_MAFAULDA_TRUTH = {
    "normal": FaultKind.HEALTHY,
    "imbalance": FaultKind.IMBALANCE,
    "horizontal-misalignment": FaultKind.MISALIGNMENT,
    "vertical-misalignment": FaultKind.MISALIGNMENT,
}

#: Bearing folders. Ball and cage faults are causes Crux does not hold (None).
_MAFAULDA_BEARING_TRUTH = {
    "outer_race": FaultKind.OUTER_RACE,
    "ball_fault": None,
    "cage_fault": None,
}


@dataclass
class Recording:
    dataset: str
    file: str  # relative to the dataset folder
    audio: np.ndarray
    fs: float
    rpm: float
    rpm_source: str  # "tachometer" or where the stated speed comes from
    truth: FaultKind | None  # None: a cause Crux does not hold (ball, cage)
    label: str  # the dataset's own words, e.g. "overhang/outer_race/20g"
    bearing: str  # text `lens.bearings.lookup` reads
    added_mass_g: float = 0.0  # MaFaulDa: imbalance mass added to a bearing-fault run
    name_hz: float | None = None  # MaFaulDa: the shaft frequency in the file name
    channels: dict[str, np.ndarray] = field(default_factory=dict)

    @property
    def held(self) -> bool:
        """Whether the true cause is one of Crux's hypotheses."""
        return self.truth is not None


def tach_rpm(tach: np.ndarray, fs: float, pulses_per_rev: int = 1) -> float:
    """Shaft speed from a once-per-revolution pulse train.

    The level is read with hysteresis, high above 70% and low below 30% of the
    5th-to-95th percentile span, so noise on a slow edge cannot count twice. The
    period is the least-squares slope of edge time against edge number, which
    averages the one-sample timing error of each edge over every revolution.
    """
    lo, hi = np.percentile(tach, [5, 95])
    span = hi - lo
    if span <= 1e-9:
        raise ValueError("the tachometer channel is flat: no pulses")
    state = np.full(len(tach), np.nan)
    state[tach > lo + 0.7 * span] = 1.0
    state[tach < lo + 0.3 * span] = 0.0
    known = np.flatnonzero(~np.isnan(state))
    if len(known) < 2:
        raise ValueError("no tachometer pulses")
    # Carry the last definite level across the band between the thresholds.
    filled = state[known][np.searchsorted(known, np.arange(len(tach)), side="right") - 1]
    filled[: known[0]] = state[known[0]]
    rising = np.flatnonzero((filled[:-1] == 0.0) & (filled[1:] == 1.0)) + 1
    if len(rising) < 3:
        raise ValueError(f"only {len(rising)} tachometer pulses: too few to time a revolution")
    period_s = np.polyfit(np.arange(len(rising)), rising / fs, 1)[0]
    return 60.0 / (period_s * pulses_per_rev)


def mafaulda_files(root: Path | None = None) -> list[Path]:
    base = root or MAFAULDA_DIR
    return sorted(base.rglob("*.csv")) if base.exists() else []


def mafaulda_label(rel: Path) -> tuple[FaultKind | None, float]:
    """The cause a MaFaulDa path names, and any imbalance mass added (grams)."""
    parts = rel.parts
    if parts[0] in _MAFAULDA_TRUTH:
        return _MAFAULDA_TRUTH[parts[0]], 0.0
    if parts[0] in ("overhang", "underhang") and len(parts) >= 3:
        mass = re.fullmatch(r"(\d+(?:\.\d+)?)g", parts[2])
        return _MAFAULDA_BEARING_TRUTH[parts[1]], float(mass.group(1)) if mass else 0.0
    raise ValueError(f"not a MaFaulDa class folder: {rel}")


def read_mafaulda(
    path: Path,
    root: Path | None = None,
    fs: float = MAFAULDA_FS,
    keep: tuple[str, ...] = (),
) -> Recording:
    """One MaFaulDa CSV: the microphone, the speed from its tachometer, the label.

    `keep` names other columns (MAFAULDA_COLUMNS) to carry along, for checks
    that need an accelerometer.
    """
    base = root or MAFAULDA_DIR
    rel = path.relative_to(base)
    data = np.loadtxt(path, delimiter=",", dtype=np.float32)
    if data.ndim != 2 or data.shape[1] != len(MAFAULDA_COLUMNS):
        raise ValueError(f"{rel}: expected {len(MAFAULDA_COLUMNS)} columns, got {data.shape}")
    col = {name: data[:, i] for i, name in enumerate(MAFAULDA_COLUMNS)}
    truth, mass = mafaulda_label(rel)
    try:
        name_hz: float | None = float(path.stem)
    except ValueError:
        name_hz = None
    return Recording(
        dataset="mafaulda",
        file=rel.as_posix(),
        audio=col["microphone"].astype(float),
        fs=fs,
        rpm=tach_rpm(col["tachometer"], fs),
        rpm_source="tachometer",
        truth=truth,
        label=rel.parent.as_posix(),
        bearing=MAFAULDA_BEARING,
        added_mass_g=mass,
        name_hz=name_hz,
        channels={k: col[k].astype(float) for k in keep},
    )


def jung_files(root: Path | None = None) -> list[Path]:
    base = root or JUNG_DIR
    return sorted(base.glob("*.mat")) if base.exists() else []


_JUNG_NAME = re.compile(r"(\d+)Nm_(Normal|BPFI|BPFO)(?:_(\d+))?", re.IGNORECASE)
_JUNG_TRUTH = {
    "NORMAL": FaultKind.HEALTHY,
    "BPFI": FaultKind.INNER_RACE,
    "BPFO": FaultKind.OUTER_RACE,
}


def read_jung(path: Path) -> Recording:
    """One Jung et al. 2023 microphone file (`0Nm_BPFO_10.mat`: outer race, 1.0 mm crack).

    The file holds a `Signal` struct: the pressures in `y_values.values`, the
    sample spacing in `x_values.increment` (1/51,200 s in the published files).
    """
    from scipy.io import loadmat

    m = _JUNG_NAME.fullmatch(path.stem)
    if m is None:
        raise ValueError(f"not a Jung et al. file name: {path.name}")
    sig = loadmat(path, squeeze_me=True, struct_as_record=False)["Signal"]
    audio = np.asarray(sig.y_values.values, dtype=float).ravel()
    fs = 1.0 / float(sig.x_values.increment)
    size = f", {int(m.group(3)) / 10:.1f} mm crack" if m.group(3) else ""
    return Recording(
        dataset="jung2023",
        file=path.name,
        audio=audio,
        fs=fs,
        rpm=JUNG_RPM,
        rpm_source="stated in Jung et al. 2023",
        truth=_JUNG_TRUTH[m.group(2).upper()],
        label=f"{m.group(1)} Nm, {m.group(2).lower()}{size}",
        bearing=JUNG_BEARING,
    )


def windows(rec: Recording, seconds: float) -> list[np.ndarray]:
    """Consecutive, non-overlapping pieces of the sound, each `seconds` long."""
    n = int(round(seconds * rec.fs))
    return [rec.audio[i : i + n] for i in range(0, len(rec.audio) - n + 1, n)]
