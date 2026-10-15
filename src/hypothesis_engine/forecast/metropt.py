"""MetroPT-3: the watcher on a different machine, a metro train's air compressor.

No vibration here: pressures, oil temperature, motor current and valve states
logged every 10 s from February to September 2020 (UCI dataset 791, CC BY 4.0,
doi 10.24432/C5VW3R). The failures are air leaks, so the health signal follows
from what a leak does: the compressor has to run loaded more often to hold the
pressure. That signal was fixed before any failure window was looked at.

- Load: `DV_eletric` (sic, the dataset's spelling) is "active when the compressor
  is functioning under load" (UCI variable description). Its hourly mean is the
  loaded share of that hour.
- Signal: the loaded share over the trailing 24 hours, so the daily timetable
  (busy days, idle nights) does not look like a fault.
- Normal: the first month, which UCI recommends for training.
- Alarm: the bearing watcher's frozen rules (onset.py), unchanged: 3 sigma and at
  least a doubling, for `CONSECUTIVE` hours in a row. It re-arms once the signal
  is back under the limit, because the compressor is repaired and runs on.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .onset import CONSECUTIVE, MIN_RISE, SIGMA_K
from .runs import DATA_ROOT

METRO_DIR = DATA_ROOT / "metropt"
METRO_CSV = METRO_DIR / "MetroPT3(AirCompressor).csv"

#: Company-reported failures, all air leaks with "High stress" severity (UCI
#: dataset page, read 6 Oct 2026). The page numbers the first two both "#1" and
#: dates one report's maintenance (30 Apr) before its failure (29 May); the
#: windows are used as printed.
FAILURES: tuple[tuple[str, str], ...] = (
    ("2020-04-18T00:00", "2020-04-18T23:59"),
    ("2020-05-29T23:30", "2020-05-30T06:00"),
    ("2020-06-05T10:00", "2020-06-07T14:30"),
    ("2020-07-15T14:30", "2020-07-15T19:00"),
)

#: Hours averaged into the signal: one day, so the timetable cancels out.
WINDOW_H = 24

#: "The first month can be used for training the model" (UCI dataset page).
BASELINE_END = np.datetime64("2020-03-01T00:00")

#: A rolling baseline: how much recent history counts as normal. Chosen before
#: the run: four weeks spans four weekly timetables, so a lasting change in use
#: becomes the new normal within a month, while a leak (hours to days) still
#: stands out against it.
ROLL_DAYS = 28

#: The latest hours are kept out of the rolling baseline, so a fault that is
#: still developing is not learned as normal before it is flagged.
GAP_H = 24

#: An alarm that starts this long before a failure window counts as a warning
#: for it. Chosen: a day is enough to plan a repair, and a longer reach would
#: credit alarms that may have nothing to do with the leak.
REACH_H = 24


@dataclass(frozen=True)
class Hourly:
    hour: np.ndarray  # datetime64[h], one per clock hour that has samples
    loaded: np.ndarray  # loaded share of that hour, 0..1
    signal: np.ndarray  # loaded share over the trailing WINDOW_H hours
    oil_temp: np.ndarray  # mean oil temperature, deg C
    current: np.ndarray  # mean motor current, A


def hourly(path: Path = METRO_CSV) -> Hourly:
    """Every 10 s sample folded into clock hours. Reads the 208 MB CSV once."""
    stamps: list[str] = []
    dv: list[float] = []
    oil: list[float] = []
    amp: list[float] = []
    with path.open(newline="") as fh:
        rows = csv.reader(fh)
        head = next(rows)
        i_t, i_dv = head.index("timestamp"), head.index("DV_eletric")
        i_oil, i_amp = head.index("Oil_temperature"), head.index("Motor_current")
        for r in rows:
            stamps.append(r[i_t][:13])  # "YYYY-MM-DD HH"
            dv.append(float(r[i_dv]))
            oil.append(float(r[i_oil]))
            amp.append(float(r[i_amp]))
    hours = np.array([s.replace(" ", "T") for s in stamps], dtype="datetime64[h]")
    uniq, inverse = np.unique(hours, return_inverse=True)
    count = np.bincount(inverse).astype(float)

    def mean(x: list[float]) -> np.ndarray:
        return np.bincount(inverse, weights=np.asarray(x)) / count

    loaded = mean(dv)
    return Hourly(uniq, loaded, trailing(uniq, loaded), mean(oil), mean(amp))


def trailing(hour: np.ndarray, values: np.ndarray, window_h: int = WINDOW_H) -> np.ndarray:
    """Mean over the hours in (t - window, t] that have data. Causal."""
    t = hour.astype("int64")
    out = np.empty(len(values))
    lo = 0
    total = 0.0
    for i in range(len(values)):
        total += values[i]
        while t[lo] <= t[i] - window_h:
            total -= values[lo]
            lo += 1
        out[i] = total / (i - lo + 1)
    return out


def limit(signal: np.ndarray, hour: np.ndarray) -> float:
    """The bearing watcher's limit, with the first month as healthy."""
    base = signal[hour < BASELINE_END]
    mean, std = float(np.mean(base)), float(np.std(base, ddof=1))
    return max(mean + SIGMA_K * std, mean * (1.0 + MIN_RISE))


def rolling_limits(
    signal: np.ndarray, hour: np.ndarray, roll_days: int = ROLL_DAYS, gap_h: int = GAP_H
) -> np.ndarray:
    """Per hour, the watcher's limit from that machine's own recent normal.

    Until the first month is over, the first month's limit holds. After that the
    limit at hour t comes from the hours in [t - gap - roll, t - gap) that were
    under their own limit: hours already flagged never become normal. Causal.
    """
    fixed = limit(signal, hour)
    t = hour.astype("int64")
    start = int(BASELINE_END.astype("datetime64[h]").astype("int64"))
    lims = np.full(len(signal), fixed)
    normal = np.zeros(len(signal), dtype=bool)
    lo = 0
    for i in range(len(signal)):
        if t[i] >= start:
            while t[lo] < t[i] - gap_h - roll_days * 24:
                lo += 1
            window = [k for k in range(lo, i) if t[k] < t[i] - gap_h and normal[k]]
            if len(window) > 1:
                base = signal[window]
                mean, std = float(np.mean(base)), float(np.std(base, ddof=1))
                lims[i] = max(mean + SIGMA_K * std, mean * (1.0 + MIN_RISE))
        normal[i] = signal[i] <= lims[i]
    return lims


def alarms(
    signal: np.ndarray, line: float | np.ndarray, consecutive: int = CONSECUTIVE
) -> list[tuple[int, int]]:
    """(fired, cleared) index pairs: fired on the last of `consecutive` hours above.

    `line` is one limit for every hour, or one limit per hour (a rolling baseline).
    """
    lines = np.broadcast_to(np.asarray(line, dtype=float), np.shape(signal))
    out: list[tuple[int, int]] = []
    run = 0
    fired: int | None = None
    for i, v in enumerate(signal):
        if v > lines[i]:
            run += 1
            if run >= consecutive and fired is None:
                fired = i
        else:
            if fired is not None:
                out.append((fired, i))
            run, fired = 0, None
    if fired is not None:
        out.append((fired, len(signal) - 1))
    return out


@dataclass(frozen=True)
class Verdict:
    failure: tuple[str, str]
    warned: bool  # an alarm came before the failure window began
    lead_h: float | None  # alarm to window start; negative when it came during the window


def score(
    h: Hourly, line: float | np.ndarray
) -> tuple[list[Verdict], list[tuple[str, str]], float]:
    """Per failure: was there a warning, and how early. Then the alarms that warned of nothing.

    Returns (verdicts, false alarms as (fired, cleared) times, months watched
    after the baseline month).
    """
    return score_episodes(h.hour, alarms(h.signal, line))


def score_episodes(
    hour: np.ndarray, episodes: list[tuple[int, int]]
) -> tuple[list[Verdict], list[tuple[str, str]], float]:
    """`score`'s rules for any detector's alarms, as (fired, cleared) indexes into `hour`."""
    hour = np.asarray(hour, dtype="datetime64[h]")
    reach = np.timedelta64(REACH_H, "h")
    windows = [(np.datetime64(a, "h"), np.datetime64(b, "h")) for a, b in FAILURES]
    verdicts = []
    for (a, b), raw in zip(windows, FAILURES, strict=True):
        hits = [hour[f] for f, _ in episodes if a - reach <= hour[f] <= b]
        if hits:
            lead = float((a - min(hits)) / np.timedelta64(1, "h"))
            verdicts.append(Verdict(raw, lead > 0, lead))
        else:
            verdicts.append(Verdict(raw, False, None))
    false = [
        (str(hour[f]), str(hour[c]))
        for f, c in episodes
        if hour[f] >= BASELINE_END
        and not any(a - reach <= hour[f] <= b + reach for a, b in windows)
    ]
    months = float((hour[-1] - BASELINE_END) / np.timedelta64(1, "h")) / (24 * 30.4)
    return verdicts, false, months
