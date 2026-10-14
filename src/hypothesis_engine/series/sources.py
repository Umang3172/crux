"""The sensor history in one shape: a regular time grid per source and cadence.

The compressor's raw file is 218 MB of 10-second samples. `prepare()` folds it
once into one-minute, fifteen-minute and hourly means under `data/series/`;
nothing reads the raw file per request. Its clock has holes (the longest is
two days, from 25 Apr 2020), and TimesFM wants a regular grid, so a missing
minute takes the value of the same minute a day earlier and is marked `filled`.
Charts draw filled stretches as gaps and "what changed" leaves them out.

The bearing rig's snapshots are already every 10 minutes (forecast/health.py).
They carry no wall clock here, so their time is minutes from the run's start.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

from ..forecast import health
from ..forecast.metropt import FAILURES, METRO_CSV
from ..forecast.runs import DATA_ROOT
from .settings import METRO_COLUMNS, OFF_BELOW_A, RUNNING_SHARE, SERIES_DIR

#: Raw columns read, and the prepared column each becomes. `DV_eletric` (sic) is
#: on while the compressor runs loaded; its mean over a minute is the loaded
#: share, kept in percent.
_RAW = {
    "DV_eletric": "loaded",
    "Motor_current": "motor_current",
    "Oil_temperature": "oil_temp",
    "TP3": "tp3",
    "Reservoirs": "reservoirs",
    "Towers": "towers",
}

CADENCES = (1, 15, 60)
DAY_MIN = 24 * 60

IMS_TABLE = DATA_ROOT / "forecast" / "health_ims.csv"
IMS_SERIES = SERIES_DIR / "ims_health.csv"

#: A bearing run's clock in BigQuery: snapshot i at i x 10 minutes after an
#: arbitrary epoch, because the health table keeps no wall clock and TimesFM
#: needs a regular step. IMS test 1's first snapshots came every 5 minutes, so
#: its first hours run slightly long on this clock; the week checked is regular.
IMS_EPOCH = np.datetime64("2000-01-01T00:00", "m")


@dataclass
class Table:
    """Means on a regular grid. `t` is the start of each step."""

    cadence_min: int
    t: np.ndarray  # datetime64[m]
    cols: dict[str, np.ndarray]
    filled: np.ndarray  # bool: no sample fell in this step

    def __len__(self) -> int:
        return len(self.t)

    def index(self, when: np.datetime64) -> int:
        """Position of the first step starting at or after `when`."""
        return int(np.searchsorted(self.t, np.datetime64(when, "m")))


def metro_path(cadence_min: int) -> Path:
    return SERIES_DIR / f"metro_{cadence_min}min.csv"


def fold(path: Path = METRO_CSV) -> Table:
    """Every 10 s sample folded into one-minute means, holes filled from the day before."""
    stamps: list[str] = []
    raw: dict[str, list[float]] = {c: [] for c in _RAW.values()}
    with path.open(newline="") as fh:
        rows = csv.reader(fh)
        head = next(rows)
        at = {col: head.index(name) for name, col in _RAW.items()}
        i_t = head.index("timestamp")
        for r in rows:
            stamps.append(r[i_t][:16])  # "YYYY-MM-DD HH:MM"
            for col, i in at.items():
                raw[col].append(float(r[i]))
    minute = np.array([s.replace(" ", "T") for s in stamps], dtype="datetime64[m]")
    start = minute.min().astype("datetime64[D]").astype("datetime64[m]")  # midnight
    k = (minute - start).astype(int)
    n = int(k.max()) + 1
    count = np.bincount(k, minlength=n).astype(float)
    filled = count == 0
    cols = {}
    for col, values in raw.items():
        total = np.bincount(k, weights=np.asarray(values), minlength=n)
        with np.errstate(invalid="ignore", divide="ignore"):
            cols[col] = total / count
    cols["loaded"] = cols["loaded"] * 100.0
    t = start + np.arange(n).astype("timedelta64[m]")
    return Table(1, t, {c: fill_from_day_before(v) for c, v in cols.items()}, filled)


def fill_from_day_before(v: np.ndarray, period: int = DAY_MIN) -> np.ndarray:
    """A missing step takes the same step a day earlier; at the very start, the next day's."""
    out = v.copy()
    for i in range(len(out)):  # forward: a two-day hole fills from the filled day before it
        if np.isnan(out[i]) and i >= period:
            out[i] = out[i - period]
    for i in range(len(out) - 1, -1, -1):
        if np.isnan(out[i]) and i + period < len(out):
            out[i] = out[i + period]
    return out


def coarsen(table: Table, cadence_min: int) -> Table:
    """Means over whole blocks of the finer grid. A block is filled if most of it was."""
    step = cadence_min // table.cadence_min
    n = len(table) // step
    cols = {c: v[: n * step].reshape(n, step).mean(axis=1) for c, v in table.cols.items()}
    filled = table.filled[: n * step].reshape(n, step).mean(axis=1) > 0.5
    return Table(cadence_min, table.t[: n * step : step], cols, filled)


def write(table: Table, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    names = list(table.cols)
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["ts", *names, "filled"])
        stamps = np.datetime_as_string(table.t, unit="m")
        for i in range(len(table)):
            w.writerow(
                [stamps[i].replace("T", " ") + ":00"]
                + [f"{table.cols[c][i]:.5g}" for c in names]
                + [int(table.filled[i])]
            )


def read(path: Path, cadence_min: int) -> Table:
    with path.open(newline="") as fh:
        rows = csv.reader(fh)
        head = next(rows)
        data = list(rows)
    names = head[1:-1]
    t = np.array([r[0][:16].replace(" ", "T") for r in data], dtype="datetime64[m]")
    cols = {c: np.array([float(r[1 + j]) for r in data]) for j, c in enumerate(names)}
    filled = np.array([r[-1] == "1" for r in data])
    return Table(cadence_min, t, cols, filled)


def prepare(raw: Path = METRO_CSV) -> dict[int, Path]:
    """Fold the raw file once and write a table per cadence. Returns where each went."""
    minute = fold(raw)
    out = {}
    for c in CADENCES:
        table = minute if c == 1 else coarsen(minute, c)
        out[c] = metro_path(c)
        write(table, out[c])
    metro.cache_clear()
    if ims_runs():
        write_ims(IMS_SERIES)
        out[0] = IMS_SERIES
    return out


def ims_time(n: int) -> np.ndarray:
    from .settings import IMS_CADENCE_MIN

    return IMS_EPOCH + (np.arange(n) * IMS_CADENCE_MIN).astype("timedelta64[m]")


def write_ims(path: Path) -> None:
    """The bearing runs as one long table, for BigQuery."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["run_id", "ts", "minute", "rms", "kurtosis"])
        for run in ims_runs().values():
            stamps = np.datetime_as_string(ims_time(len(run.minutes)), unit="m")
            for i, m in enumerate(run.minutes):
                w.writerow(
                    [
                        run.run_id,
                        stamps[i].replace("T", " ") + ":00",
                        f"{m:.4f}",
                        f"{run.cols['rms'][i]:.6g}",
                        f"{run.cols['kurtosis'][i]:.6g}",
                    ]
                )


@lru_cache(maxsize=4)
def metro(cadence_min: int) -> Table:
    """A prepared compressor table. Raises FileNotFoundError until `prepare()` has run."""
    if cadence_min not in CADENCES:
        raise ValueError(f"cadence is one of {CADENCES}")
    path = metro_path(cadence_min)
    if not path.is_file():
        raise FileNotFoundError(f"{path} is missing: run `scripts/series.py prepare`")
    table = read(path, cadence_min)
    missing = set(METRO_COLUMNS) - set(table.cols)
    if missing:
        raise ValueError(f"{path} lacks {sorted(missing)}")
    return table


def metro_running(t: np.ndarray, cadence_min: int) -> np.ndarray:
    """Whether the motor ran for most of each step starting at `t` (settings.RUNNING_SHARE).

    Read from the one-minute table, where a minute runs when the motor draws at
    least `OFF_BELOW_A`; a filled minute is not known to run.
    """
    minute = metro(1)
    on = (minute.cols["motor_current"] >= OFF_BELOW_A) & ~minute.filled
    total = np.concatenate([[0], np.cumsum(on)])
    i = np.clip(np.searchsorted(minute.t, np.asarray(t, dtype="datetime64[m]")), 0, len(on))
    j = np.minimum(i + cadence_min, len(on))
    return (total[j] - total[i]) >= RUNNING_SHARE * cadence_min


def metro_failures() -> list[dict[str, str]]:
    return [
        {"start": a, "end": b, "label": f"Air leak {i + 1}"} for i, (a, b) in enumerate(FAILURES)
    ]


@dataclass
class BearingRun:
    run_id: str
    failure_mode: str
    minutes: np.ndarray
    cols: dict[str, np.ndarray]


@lru_cache(maxsize=1)
def ims_runs() -> dict[str, BearingRun]:
    """The IMS bearings' health signals, by run id. Empty when the table is not built."""
    if not IMS_TABLE.is_file():
        return {}
    out = {}
    for h in health.load(IMS_TABLE):
        h = health.trim_stopped(h)
        out[h.run_id] = BearingRun(
            h.run_id, h.failure_mode, h.t, {"rms": h.rms, "kurtosis": h.kurtosis}
        )
    return out


def ims_check_start(n: int, check: int, min_history: int) -> int:
    """Where a run's checked stretch begins: its last `check` points, history first."""
    return max(min_history, n - check)
