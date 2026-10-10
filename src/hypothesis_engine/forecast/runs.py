"""Run-to-failure recordings: bearings recorded from new until they broke.

A *run* is one bearing's life as a sequence of short snapshots taken at a fixed
interval. CWRU cannot be used here: each of its files is a separate recording of
a fault cut to a fixed size, so it has no time axis to forecast along.

Two public sets are supported, and they play different roles:

- XJTU-SY (15 bearings, three speed/load conditions) is where models are fitted
  and compared, one held-out bearing at a time.
- IMS (NASA, four bearings on one shaft, three tests) is a different rig at a
  different time scale, used only as a final transfer test.

Nothing here touches the network. A human downloads the files; see
docs/FORECAST.md.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import numpy as np

from ..data.root import DATA_ROOT
from ..models import BearingGeometry

XJTU_DIR = DATA_ROOT / "xjtu"
IMS_DIR = DATA_ROOT / "ims"

#: XJTU-SY sampling: 25.6 kHz, 32,768 points (1.28 s) every minute, horizontal
#: and vertical PCB 352C33 accelerometers (biaowang.tech/xjtu-sy-bearing-datasets,
#: the dataset authors' page, read 3 Oct 2026).
XJTU_FS_HZ = 25_600.0
XJTU_INTERVAL_MIN = 1.0

#: The tested bearing, LDK UER204: 8 balls of 7.92 mm on a 34.55 mm mean
#: diameter, 0 deg contact angle (same page, "Bearing Testbed & Tested Bearing"
#: table). With it the physics layer can compute fault frequencies for XJTU-SY.
XJTU_BEARING = BearingGeometry(
    n_rolling_elements=8,
    ball_diameter_mm=7.92,
    pitch_diameter_mm=34.55,
    contact_angle_deg=0.0,
    label="LDK UER204",
)

#: Per bearing: CSV files (= minutes of life) and the element that failed, from
#: the same page's "Dataset details" table. Used to check a download is complete,
#: and as the answer key: the forecaster never reads it.
XJTU_BEARINGS: dict[str, tuple[int, str]] = {
    "Bearing1_1": (123, "outer race"),
    "Bearing1_2": (161, "outer race"),
    "Bearing1_3": (158, "outer race"),
    "Bearing1_4": (122, "cage"),
    "Bearing1_5": (52, "inner race and outer race"),
    "Bearing2_1": (491, "inner race"),
    "Bearing2_2": (161, "outer race"),
    "Bearing2_3": (533, "cage"),
    "Bearing2_4": (42, "outer race"),
    "Bearing2_5": (339, "outer race"),
    "Bearing3_1": (2538, "outer race"),
    "Bearing3_2": (2496, "inner race, ball, cage and outer race"),
    "Bearing3_3": (371, "inner race"),
    "Bearing3_4": (1515, "inner race"),
    "Bearing3_5": (114, "outer race"),
}

# Every IMS figure below is from "Readme Document for IMS Bearing Data.pdf",
# shipped inside IMS.zip (NASA PCoE), read 3 Oct 2026.

#: 20,480 points per 1 s snapshot, sampled at 20 kHz.
IMS_FS_HZ = 20_000.0

#: Snapshots every 10 minutes (the first 43 of test 1 every 5). "Larger intervals
#: of time stamps indicate resumption of the experiment in the next working day",
#: so a longer gap is a pause, not running time: it counts as one interval. Test 1
#: has 24 such gaps adding about 20 days of calendar time to 14 days of running.
IMS_INTERVAL_MIN = 10.0

#: Bearings that failed: test 1 inner race in bearing 3 and roller element in
#: bearing 4, test 2 outer race in bearing 1, test 3 outer race in bearing 3.
#: Bearings missing from this map survived their test, so their true failure
#: time is unknown (censored) and they are never scored.
IMS_FAILURES: dict[int, dict[int, str]] = {
    1: {3: "inner race", 4: "roller"},
    2: {1: "outer race"},
    3: {3: "outer race"},
}

#: Files per test in the archive. Tests 1 and 2 match the readme. Test 3 does
#: not: it unpacks to `4th_test/txt` with 6,324 files running to 18 Apr 2004,
#: while the readme stops at 4 Apr 2004 19:01:57 (file 4,448). Bearing 3's RMS is
#: flat at about 0.07 g up to that date and only rises, roughly elevenfold, on
#: 15-18 Apr, so the outer-race failure the readme describes is in the full
#: archive and all of it is used.
IMS_FILES: dict[int, int] = {1: 2156, 2: 984, 3: 6324}

_XJTU_CONDITION = re.compile(r"(?P<hz>\d+(?:\.\d+)?)Hz(?P<kn>\d+(?:\.\d+)?)kN", re.IGNORECASE)
_XJTU_BEARING = re.compile(r"^Bearing\d+_\d+$", re.IGNORECASE)
_IMS_STAMP = re.compile(r"^\d{4}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{2}$")
# The third test ships in a folder some archives call "4th_test".
_IMS_TEST = {"1st": 1, "2nd": 2, "3rd": 3, "4th": 3}


@dataclass(frozen=True)
class Run:
    """One bearing's recorded life, as file references; nothing is loaded yet."""

    run_id: str
    source: str  # "xjtu-sy" or "ims"
    files: tuple[Path, ...]
    times_min: tuple[float, ...]  # minutes since the first snapshot
    fs: float
    channel: int  # column holding this bearing's accelerometer
    failed: bool  # False = the test stopped first, so the life is unknown
    condition: str = ""
    failure_mode: str = ""

    def __len__(self) -> int:
        return len(self.files)

    def load(self, i: int) -> np.ndarray:
        """The i-th snapshot as a 1-D float array, mean removed."""
        x = read_table(self.files[i])[:, self.channel]
        return x - float(np.mean(x))


def read_table(path: Path) -> np.ndarray:
    """Every column of one snapshot file, as a 2-D array (rows = samples)."""
    with path.open() as fh:
        first = fh.readline()
    # XJTU-SY CSVs start with a header row; IMS files are bare numbers.
    skip = 0 if re.match(r"^\s*[-+0-9.]", first) else 1
    delimiter = "," if "," in first else None
    return np.loadtxt(path, delimiter=delimiter, skiprows=skip, dtype=float, ndmin=2)


def xjtu_runs(root: str | Path | None = None, channel: int = 0) -> list[Run]:
    """Every XJTU-SY bearing folder under `root`.

    Folders look like `<cond>/Bearing1_1/1.csv ...`, one CSV per minute, with
    horizontal then vertical acceleration. Column 0 (horizontal) is the default
    because it is the one that carries the radial load.
    """
    base = Path(root) if root is not None else XJTU_DIR
    if not base.exists():
        return []
    runs = []
    for folder in sorted(p for p in base.rglob("*") if p.is_dir() and _XJTU_BEARING.match(p.name)):
        csvs = [f for f in folder.glob("*.csv") if f.stem.isdigit()]
        if not csvs:
            continue
        csvs.sort(key=lambda f: int(f.stem))  # 10.csv after 9.csv, not after 1.csv
        cond = next(
            (m.group(0) for p in folder.parents if (m := _XJTU_CONDITION.search(p.name))), ""
        )
        runs.append(
            Run(
                run_id=f"xjtu/{cond or folder.parent.name}/{folder.name}",
                source="xjtu-sy",
                files=tuple(csvs),
                times_min=tuple((int(f.stem) - 1) * XJTU_INTERVAL_MIN for f in csvs),
                fs=XJTU_FS_HZ,
                channel=channel,
                failed=True,  # every XJTU-SY bearing was run until it failed
                condition=cond,
                failure_mode=XJTU_BEARINGS.get(folder.name, (0, ""))[1],
            )
        )
    return runs


def _ims_test_number(folder: Path) -> int | None:
    for part in (folder.name, *(p.name for p in folder.parents)):
        for key, number in _IMS_TEST.items():
            if part.lower().startswith(key):
                return number
    return None


def ims_runs(root: str | Path | None = None, include_censored: bool = False) -> list[Run]:
    """IMS bearings, one run per bearing per test.

    Each test folder holds one ASCII file per snapshot, named by its timestamp
    (`2003.10.22.12.06.24`). Test 1 recorded two accelerometers per bearing and
    tests 2 and 3 one, so bearing b sits in column 2(b-1) or b-1. Times are
    running minutes: pauses between working days are not counted.
    """
    base = Path(root) if root is not None else IMS_DIR
    if not base.exists():
        return []
    runs = []
    for folder in sorted(p for p in base.rglob("*") if p.is_dir()):
        stamped = [f for f in folder.iterdir() if f.is_file() and _IMS_STAMP.match(f.name)]
        test = _ims_test_number(folder)
        if not stamped or test is None:
            continue
        stamped.sort(key=lambda f: f.name)
        stamps = [datetime.strptime(f.name, "%Y.%m.%d.%H.%M.%S") for f in stamped]
        gaps = [
            min((b - a).total_seconds() / 60.0, IMS_INTERVAL_MIN)
            for a, b in zip(stamps, stamps[1:], strict=False)
        ]
        times = tuple(float(v) for v in np.concatenate([[0.0], np.cumsum(gaps)]))
        for bearing in range(1, 5):
            mode = IMS_FAILURES.get(test, {}).get(bearing, "")
            if not mode and not include_censored:
                continue
            runs.append(
                Run(
                    run_id=f"ims/test{test}/bearing{bearing}",
                    source="ims",
                    files=tuple(stamped),
                    times_min=times,
                    fs=IMS_FS_HZ,
                    channel=2 * (bearing - 1) if test == 1 else bearing - 1,
                    failed=bool(mode),
                    condition=f"test{test}",
                    failure_mode=mode,
                )
            )
    return runs
