"""Case Western Reserve University bearing data.

The rig cannot honestly fake a spalled race, so real bearing faults come from
CWRU recordings. The files are not in this repository (see `.gitignore`); run
`uv run python scripts/fetch_cwru.py` once to put them in `data/cwru/`, or
download them by hand:

    https://engineering.case.edu/bearingdatacenter

`docs/DATA.md` explains the naming convention, the licence and what the
benchmark built on top of this module does and does not prove.

Useful open mirrors and loaders, if you would rather not curate it by hand:

* https://github.com/Litchiware/cwru — downloads the .mat files for you
* https://github.com/srigas/CWRU_Bearing_NumPy — cleaned .npz version
* https://github.com/fonderxu/Bearing-fault-diagnosis-datasets — CWRU + Paderborn + JNU

We keep our own thin loader so nothing in the critical path depends on an
unmaintained package.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..models import SKF_6205_2RS_JEM, FaultKind, MachineSpec, Observation
from .root import DATA_ROOT

DATA_DIR = DATA_ROOT / "cwru"

CWRU_DRIVE_END = MachineSpec(
    machine_id="cwru-de",
    name="CWRU test rig, drive end",
    bearing=SKF_6205_2RS_JEM,
    nominal_rpm=1797.0,
    sample_rate_hz=12_000.0,
    notes="2 hp Reliance Electric motor; drive-end accelerometer at 12 kHz",
)

#: Approximate shaft speed at each motor load, from the CWRU dataset description
#: (0/1/2/3 hp). A fallback only: a file carrying its own `X###RPM` variable wins,
#: because BPFO is 3.58x shaft speed, so the 67 rpm spread across this table moves
#: the predicted BPFO by ~4 Hz — wider than the +/-3 Hz window the envelope peak
#: search uses, which would make us look for the defect in the wrong bin.
LOAD_TO_RPM: dict[int, float] = {0: 1797.0, 1: 1772.0, 2: 1750.0, 3: 1730.0}

#: The healthy baselines are published as bare file numbers, one per motor load.
#: Source: CWRU Bearing Data Center, "Normal Baseline Data" table.
NORMAL_BASELINE_IDS: dict[str, int] = {"97": 0, "98": 1, "99": 2, "100": 3}

_FAULT_KINDS: dict[str, FaultKind] = {
    "IR": FaultKind.INNER_RACE,
    "OR": FaultKind.OUTER_RACE,
}

# CWRU filenames encode fault type, fault diameter in thousandths of an inch, an
# optional clock position for outer-race defects, and the motor load in hp:
#   IR007_0      inner race, 0.007", 0 hp
#   OR021@6_2    outer race, 0.021", defect at 6 o'clock, 2 hp
#   normal_0     healthy, 0 hp
# The leading `(?:.*[_-])??` tolerates the descriptive prefixes some mirrors add
# (e.g. "12k_Drive_End_IR007_0") without needing a separate pattern per mirror.
_NORMAL_RE = re.compile(r"(?:.*[_-])??normal(?:[_-](?P<load>[0-3]))?", re.IGNORECASE)
_FAULT_RE = re.compile(
    r"(?:.*[_-])??(?P<prefix>IR|OR|B)(?P<thou>\d{3})"
    r"(?:@(?P<clock>\d{1,2}))?(?:[_-](?P<load>[0-3]))?",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class CwruCase:
    """Ground truth for one recording, read from its filename alone.

    The benchmark has to know what a file *is* before it opens it, so this is
    pure: no I/O and no scipy. `rpm` is the motor-load fallback; the speed a
    capture actually gets comes from the file when it carries one.
    """

    file: Path
    kind: FaultKind
    diameter_in: float | None  # None for the healthy baselines: there is no defect
    load_hp: int | None
    rpm: float
    clock_position: int | None = None  # outer-race defects only; 12, 3 or 6 o'clock

    @property
    def label(self) -> str:
        parts = [self.kind.value.replace("_", " ")]
        if self.diameter_in is not None:
            parts.append(f'{self.diameter_in:.3f}"')
        if self.clock_position is not None:
            parts.append(f"@{self.clock_position}")
        if self.load_hp is not None:
            parts.append(f"{self.load_hp} hp")
        return " ".join(parts)


def parse_filename(path: str | Path) -> CwruCase:
    """Read the ground truth out of a CWRU filename.

    Raises `ValueError` for anything we cannot map onto a `FaultKind`, rather
    than guessing: a benchmark that silently relabels a file is worse than one
    that skips it and says so.
    """
    path = Path(path)
    stem = path.stem

    normal = _NORMAL_RE.fullmatch(stem)
    if normal is not None:
        load = normal.group("load")
        load_hp = int(load) if load is not None else None
        return CwruCase(
            file=path,
            kind=FaultKind.HEALTHY,
            diameter_in=None,
            load_hp=load_hp,
            rpm=LOAD_TO_RPM.get(load_hp, CWRU_DRIVE_END.nominal_rpm),
        )

    if stem in NORMAL_BASELINE_IDS:
        load_hp = NORMAL_BASELINE_IDS[stem]
        return CwruCase(
            file=path,
            kind=FaultKind.HEALTHY,
            diameter_in=None,
            load_hp=load_hp,
            rpm=LOAD_TO_RPM[load_hp],
        )

    match = _FAULT_RE.fullmatch(stem)
    if match is None:
        raise ValueError(
            f"{path.name}: not a recognised CWRU name. Bare file numbers other than "
            f"{sorted(NORMAL_BASELINE_IDS)} carry no ground truth — fetch with "
            "scripts/fetch_cwru.py, which names files by fault."
        )

    prefix = match.group("prefix").upper()
    if prefix == "B":
        raise ValueError(
            f"{path.name}: ball defect. This engine has no ball-defect hypothesis "
            "(see docs/DATA.md), and mapping it onto a race fault would fake the result."
        )

    load = match.group("load")
    load_hp = int(load) if load is not None else None
    clock = match.group("clock")
    return CwruCase(
        file=path,
        kind=_FAULT_KINDS[prefix],
        diameter_in=int(match.group("thou")) / 1000.0,
        load_hp=load_hp,
        rpm=LOAD_TO_RPM.get(load_hp, CWRU_DRIVE_END.nominal_rpm),
        clock_position=int(clock) if clock is not None else None,
    )


def available(directory: str | Path | None = None) -> list[Path]:
    """The .mat files we can see right now."""
    root = Path(directory) if directory is not None else DATA_DIR
    if not root.exists():
        return []
    return sorted(root.glob("*.mat"))


def _first_channel(raw: object) -> np.ndarray:
    """One acceleration channel as a 1-D float array.

    Some files store the channel as (N, 1), a few as (N, 2) where the second
    column is a repeat acquisition. We take the first column and say so here
    rather than letting a silent `squeeze()` hand a 2-D array to the FFT.
    """
    x = np.asarray(raw, dtype=float).squeeze()
    if x.ndim == 1:
        return x
    if x.ndim == 2:
        column = x[:, 0] if x.shape[0] >= x.shape[1] else x[0, :]
        return np.ascontiguousarray(column)
    raise ValueError(f"unexpected channel shape {x.shape}; expected 1-D or 2-D")


def _rpm_from_mat(mat: dict[str, object], keys: list[str]) -> float | None:
    """The `X###RPM` scalar, if this file has one and it is usable."""
    rpm_key = next((k for k in keys if k.upper().endswith("RPM")), None)
    if rpm_key is None:
        return None
    value = np.asarray(mat[rpm_key], dtype=float).squeeze()
    if value.size != 1:
        return None
    rpm = float(value)
    return rpm if rpm > 0 else None


def load_capture(
    path: str | Path,
    rpm: float | None = None,
    duration_s: float | None = None,
    offset_s: float = 0.0,
) -> Observation:
    """Load one CWRU .mat file as an Observation.

    CWRU stores variables like `X097_DE_time` (drive end), `X097_FE_time` (fan
    end) and `X097RPM` — but not every file has all three, so we fall back to
    the fan-end channel and note it in the source string, because a fan-end
    capture sees the drive-end bearing through the shaft and its impacts are
    weaker. Speed comes from the file, then the motor-load table, then the
    nominal speed, in that order; see `LOAD_TO_RPM` for why the order matters.

    `duration_s` trims to N seconds, starting `offset_s` into the recording. The
    recordings are ~10 s and the envelope analysis runs several FFTs per
    hypothesis, so the benchmark opens a case on the first stretch and answers
    a requested capture from the one after it.
    """
    from scipy.io import loadmat  # imported lazily: scipy is heavy

    path = Path(path)
    mat = loadmat(str(path))
    keys = sorted(k for k in mat if not k.startswith("__"))

    de_key = next((k for k in keys if k.endswith("_DE_time")), None)
    fe_key = next((k for k in keys if k.endswith("_FE_time")), None)
    channel_key = de_key or fe_key
    if channel_key is None:
        raise ValueError(f"{path.name} has no drive-end or fan-end channel; found {keys}")

    x = _first_channel(mat[channel_key])
    x = x[int(offset_s * CWRU_DRIVE_END.sample_rate_hz) :]
    if duration_s is not None:
        x = x[: int(duration_s * CWRU_DRIVE_END.sample_rate_hz)]
    if x.size == 0:
        raise ValueError(f"{path.name}: channel {channel_key} is empty from {offset_s:g} s")

    notes: list[str] = []
    if de_key is None:
        notes.append("fan-end channel: no drive-end data in this file")

    if rpm is None:
        rpm = _rpm_from_mat(mat, keys)
        if rpm is None:
            rpm = _load_table_rpm(path)
            notes.append("speed from the motor-load table: no RPM in this file")

    source = f"cwru:{path.name}"
    if notes:
        source += f" [{'; '.join(notes)}]"

    return Observation(
        machine_id=CWRU_DRIVE_END.machine_id,
        waveform=x,
        sample_rate_hz=CWRU_DRIVE_END.sample_rate_hz,
        rpm=float(rpm),
        source=source,
    )


def _load_table_rpm(path: Path) -> float:
    """Filename-derived speed, or the rig's nominal speed if the name says nothing."""
    try:
        return parse_filename(path).rpm
    except ValueError:
        return CWRU_DRIVE_END.nominal_rpm
