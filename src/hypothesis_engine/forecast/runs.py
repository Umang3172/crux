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

DATA_ROOT = Path(__file__).resolve().parents[3] / "data"
XJTU_DIR = DATA_ROOT / "xjtu"
IMS_DIR = DATA_ROOT / "ims"

#: XJTU-SY sampling: 25.6 kHz, one 1.28 s snapshot every minute
#: (github.com/WangBiaoXJTU/xjtu-sy-bearing-datasets; figures via arXiv 2510.17846).
XJTU_FS_HZ = 25_600.0
XJTU_INTERVAL_MIN = 1.0

#: IMS sampling: 20 kHz, 1 s snapshots every 10 minutes (arXiv 1703.06272). The
#: interval is read from the file names rather than assumed, because the first
#: test's opening hours were logged more often.
IMS_FS_HZ = 20_000.0

#: Which IMS bearings ran to failure, as stated in the readme inside IMS.zip.
#: NOT yet checked against that file in this repo. Confirm it on first download
#: before quoting any IMS number (docs/FORECAST.md). Bearings missing from this
#: map survived their test, so their true failure time is unknown (censored)
#: and they are never scored.
IMS_FAILURES: dict[int, dict[int, str]] = {
    1: {3: "inner race", 4: "roller"},
    2: {1: "outer race"},
    3: {3: "outer race"},
}

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
        x = _read_column(self.files[i], self.channel)
        return x - float(np.mean(x))


def _read_column(path: Path, column: int) -> np.ndarray:
    with path.open() as fh:
        first = fh.readline()
    # XJTU-SY CSVs start with a header row; IMS files are bare numbers.
    skip = 0 if re.match(r"^\s*[-+0-9.]", first) else 1
    delimiter = "," if "," in first else None
    return np.loadtxt(path, delimiter=delimiter, skiprows=skip, usecols=(column,), dtype=float)


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
    tests 2 and 3 one, so bearing b sits in column 2(b-1) or b-1.
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
        times = tuple((s - stamps[0]).total_seconds() / 60.0 for s in stamps)
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
