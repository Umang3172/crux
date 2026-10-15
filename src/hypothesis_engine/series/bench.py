"""How far to trust the Trends tab's models: each scored on every day of the record.

The five moments in the tab are pictures. This scores the same models on every
day the record allows, by rules written in docs/SERIES.md ("Benchmark") on 15
Oct 2026 before any of it ran:

- Next day: from 08:00 each day, the next 96 fifteen-minute steps of the
  loaded share. TimesFM 3.0 as the tab runs it, TimesFM 3.0 alone, TimesFM 2.5
  with up to 160 days behind it, and the same time yesterday.
- Leaks: Crux's watcher, TimesFM's anomaly check, the offline band and a plain
  rule, each turned into alarms and scored by the watcher's own rules
  (`forecast.metropt.score_episodes`).

Scoring is numpy and needs no network. The TimesFM rows need the Google run
(`run_bigquery`); without it the board holds the rows that run here.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from ..forecast import metropt
from ..forecast.onset import CONSECUTIVE
from . import offline, sources, views
from .settings import (
    ANOMALY_PROB,
    CONFIDENCE,
    CONTEXT,
    OFF_BELOW_A,
    OFFLINE_DAYS,
    OFFLINE_K,
    RUNNING_SHARE,
    SNAPSHOT_DIR,
    Preset,
    span,
)

SIGNAL = "loaded"
CADENCE_MIN = 15
PER_DAY = 24 * 60 // CADENCE_MIN
HORIZON = PER_DAY
#: The next-day forecast starts where the tab's moments do: 08:00.
ORIGIN_MINUTE = 8 * 60
#: TimesFM 2.5's longest context (AI.FORECAST reference, read 15 Oct 2026): 160
#: days of fifteen-minute steps. BigQuery picks the context that covers what it is given.
LONG_CONTEXT = 15360
#: The plain rule, as first checked on 14 Oct 2026: loaded for at least this
#: share of an hour's running minutes, two hours in a row.
PLAIN_LOADED = 0.8
PLAIN_CONSECUTIVE = 2

TIMESFM_3 = "TimesFM 3.0"
TIMESFM_25 = "TimesFM 2.5"

#: The next-day methods, in the order the board lists them; the last is the bar.
METHODS = {
    "timesfm3_helpers": ("TimesFM 3.0 as the tab runs it, with helpers", "google"),
    "timesfm3_alone": ("TimesFM 3.0, loaded share alone", "google"),
    "timesfm25_long": ("TimesFM 2.5, up to 160 days behind it", "google"),
    "yesterday": ("Same time yesterday", "baseline"),
}
BAR = "yesterday"

DETECTORS = {
    "watcher": ("Crux's watcher, its own last 28 days as normal", "crux"),
    "timesfm": ("TimesFM 3.0 anomaly check, a day at a time", "google"),
    "band": ("Same time of day over 14 days, 3 spreads", "baseline"),
    "plain": ("Loaded 80% of running time, two hours in a row", "baseline"),
}

BENCH_FILE = "bench.json"


def bench_path(engine: str) -> Path:
    return SNAPSHOT_DIR / engine / "metro" / BENCH_FILE


# The days.


def origins(t: np.ndarray, n: int | None = None) -> np.ndarray:
    """Indexes of 08:00 on each day with CONTEXT steps before it and HORIZON after."""
    t = np.asarray(t, dtype="datetime64[m]")
    minute = (t - t.astype("datetime64[D]")).astype("timedelta64[m]").astype(int)
    i = np.flatnonzero(minute == ORIGIN_MINUTE)
    end = len(t) if n is None else n
    return i[(i >= CONTEXT) & (i + HORIZON <= end)]


def day_starts(t: np.ndarray) -> np.ndarray:
    """Indexes of midnight on each whole day with CONTEXT steps before it."""
    t = np.asarray(t, dtype="datetime64[m]")
    minute = (t - t.astype("datetime64[D]")).astype("timedelta64[m]").astype(int)
    i = np.flatnonzero(minute == 0)
    return i[(i >= CONTEXT) & (i + PER_DAY <= len(t))]


def origin_presets(t: np.ndarray, idx: np.ndarray) -> list[Preset]:
    """Each origin as a moment the SQL builders take: its id is the day."""
    out = []
    for i in idx:
        stamp = str(np.datetime64(t[i], "m"))
        out.append(Preset("d" + stamp[:10].replace("-", ""), stamp[:10], stamp, ""))
    return out


def leak_days(t: np.ndarray, idx: np.ndarray, horizon: int = HORIZON) -> np.ndarray:
    """Whether each origin's next `horizon` steps overlap a reported leak."""
    windows = [(np.datetime64(a, "m"), np.datetime64(b, "m")) for a, b in metropt.FAILURES]
    out = np.zeros(len(idx), dtype=bool)
    step = np.timedelta64(CADENCE_MIN, "m")
    for k, i in enumerate(idx):
        start, end = t[i], t[i] + horizon * step
        out[k] = any(start <= b and a < end for a, b in windows)
    return out


# Next day.


@dataclass
class Forecasts:
    """One method's next day from every origin: rows are origins, NaN where it gave none."""

    mid: np.ndarray
    lo: np.ndarray
    hi: np.ndarray

    @classmethod
    def empty(cls, n: int) -> Forecasts:
        return cls(*(np.full((n, HORIZON), np.nan) for _ in range(3)))


def yesterday(v: np.ndarray, filled: np.ndarray, idx: np.ndarray) -> Forecasts:
    """The bar: the same time a day earlier, with the stand-in's band from its own errors."""
    out = Forecasts.empty(len(idx))
    for k, i in enumerate(idx):
        out.mid[k], out.lo[k], out.hi[k] = offline.seasonal_band(
            v, filled, int(i), HORIZON, PER_DAY
        )
    return out


def ahead(x: np.ndarray, idx: np.ndarray) -> np.ndarray:
    """The next HORIZON steps of `x` from each origin, as rows."""
    return np.stack([x[i : i + HORIZON] for i in idx])


def forecast_scores(
    actual: np.ndarray,
    known: np.ndarray,
    methods: dict[str, Forecasts],
    groups: dict[str, np.ndarray],
    bar: str = BAR,
) -> dict[str, Any]:
    """Each method's typical miss, its miss against the bar's, and how often its band held.

    Scored on the steps that are `known`, as drawn (within 0 to 100%), on the
    origins every method forecast, so every method answers for the same steps.
    """
    common = np.ones(len(actual), dtype=bool)
    for f in methods.values():
        common &= np.all(np.isfinite(f.mid) & np.isfinite(f.lo) & np.isfinite(f.hi), axis=1)
    out: dict[str, Any] = {}
    for g, chosen in groups.items():
        sel = chosen & common
        mask = known[sel]
        truth = actual[sel][mask]
        err = {
            m: np.abs(views.clipped(SIGNAL, f.mid[sel])[mask] - truth) for m, f in methods.items()
        }
        bar_total = float(err[bar].sum()) if bar in err else float("nan")
        rows = []
        for m, f in methods.items():
            lo = views.clipped(SIGNAL, f.lo[sel])[mask]
            hi = views.clipped(SIGNAL, f.hi[sel])[mask]
            n = len(truth)
            rows.append(
                {
                    "id": m,
                    "mae": float(err[m].mean()) if n else None,
                    "vs_bar": float(err[m].sum()) / bar_total if n and bar_total > 0 else None,
                    "inside": float(np.mean((truth >= lo) & (truth <= hi))) if n else None,
                }
            )
        out[g] = {"days": int(sel.sum()), "steps": int(mask.sum()), "rows": rows}
    out["left_out"] = int((~common).sum())
    return out


# Leaks.


def hourly_any(t: np.ndarray, flags: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Clock hours, and whether any step in each was flagged."""
    hour = np.asarray(t, dtype="datetime64[m]").astype("datetime64[h]")
    uniq, inv = np.unique(hour, return_inverse=True)
    return uniq, np.bincount(inv, weights=flags.astype(float), minlength=len(uniq)) > 0


def alarm_episodes(flagged: np.ndarray, consecutive: int) -> list[tuple[int, int]]:
    """The watcher's onset rule on flagged hours: fires on the `consecutive`-th in a row."""
    return metropt.alarms(flagged.astype(float), 0.5, consecutive)


def leak_score(hour: np.ndarray, episodes: list[tuple[int, int]]) -> dict[str, Any]:
    verdicts, false, months = metropt.score_episodes(hour, episodes)
    leads = [v.lead_h for v in verdicts]
    return {
        "caught": sum(lead is not None for lead in leads),
        "of": len(verdicts),
        "before": sum(v.warned for v in verdicts),
        "leads_h": leads,
        "false": len(false),
        "months": round(months, 2),
        "per_month": len(false) / months if months > 0 else None,
    }


def counted_flags(flagged: np.ndarray, filled: np.ndarray, running: np.ndarray) -> np.ndarray:
    """A step outside the band counts while the motor ran most of it, as in the tab."""
    return flagged & ~filled & running


def band_flags(v: np.ndarray, filled: np.ndarray, starts: np.ndarray) -> np.ndarray:
    """The offline band, a day at a time: each day held to the 14 days before it."""
    out = np.zeros(len(v), dtype=bool)
    for a in starts:
        med, sd = offline._band_by_slot(v, filled, int(a), PER_DAY, PER_DAY)
        x = v[a : a + PER_DAY]
        out[a : a + PER_DAY] = (x < med - OFFLINE_K * sd) | (x > med + OFFLINE_K * sd)
    return out


def plain_hours(minute: sources.Table) -> tuple[np.ndarray, np.ndarray]:
    """Hours the motor ran at least half of and spent at least 80% of that running loaded."""
    on = (minute.cols["motor_current"] >= OFF_BELOW_A) & ~minute.filled
    loaded = minute.cols["loaded"] / 100.0
    hour = minute.t.astype("datetime64[h]")
    uniq, inv = np.unique(hour, return_inverse=True)
    ran = np.bincount(inv, weights=on.astype(float), minlength=len(uniq))
    busy = np.bincount(inv, weights=loaded * on, minlength=len(uniq))
    with np.errstate(invalid="ignore", divide="ignore"):
        share = np.where(ran > 0, busy / ran, 0.0)
    return uniq, (ran >= RUNNING_SHARE * 60) & (share >= PLAIN_LOADED)


def leaks_offline(table: sources.Table, starts: np.ndarray) -> dict[str, dict[str, Any]]:
    """The detectors that run here: the watcher, the band and the plain rule."""
    out: dict[str, dict[str, Any]] = {}
    if metropt.METRO_CSV.exists():
        h = metropt.hourly()
        line = metropt.rolling_limits(h.signal, h.hour)
        out["watcher"] = leak_score(h.hour, metropt.alarms(h.signal, line))
    running = sources.metro_running(table.t, CADENCE_MIN)
    v = table.cols[SIGNAL]
    band = counted_flags(band_flags(v, table.filled, starts), table.filled, running)
    hour, flagged = hourly_any(table.t, band)
    out["band"] = leak_score(hour, alarm_episodes(flagged, CONSECUTIVE))
    hour, flagged = plain_hours(sources.metro(1))
    out["plain"] = leak_score(hour, alarm_episodes(flagged, PLAIN_CONSECUTIVE))
    return out


# The board.


def board(
    engine: str,
    forecast: dict[str, Any],
    leaks: dict[str, dict[str, Any]],
    made: dict[str, Any],
    check: dict[str, Any] | None = None,
) -> dict[str, Any]:
    def named(table: dict[str, tuple[str, str]], row: dict[str, Any]) -> dict[str, Any]:
        method, by = table[row["id"]]
        return {**row, "method": method, "by": by}

    fc = {
        g: {**v, "rows": [named(METHODS, r) for r in v["rows"]]}
        for g, v in forecast.items()
        if isinstance(v, dict)
    }
    return {
        "source": "metro",
        "view": "bench",
        "engine": engine,
        "signal": SIGNAL,
        "forecast": {
            "horizon_steps": HORIZON,
            "cadence_min": CADENCE_MIN,
            "groups": fc,
            "left_out": forecast.get("left_out", 0),
            "check": check,
        },
        "leaks": [
            {"id": k, **named(DETECTORS, {"id": k}), **v}
            for k, v in leaks.items()
            if k in DETECTORS
        ],
        "made": made,
    }


def build_offline() -> dict[str, Any]:
    """The rows that run here: the bar for the next day, and three of the four detectors."""
    table = sources.metro(CADENCE_MIN)
    v, filled = table.cols[SIGNAL], table.filled
    idx = origins(table.t)
    actual, known = ahead(v, idx), ~ahead(filled, idx)
    leak = leak_days(table.t, idx)
    forecast = forecast_scores(
        actual, known, {BAR: yesterday(v, filled, idx)}, {"normal": ~leak, "leak": leak}
    )
    made = views.Made(
        views.OFFLINE,
        "stand-ins only: the TimesFM rows need the Google run",
        "none (offline)",
        settings={
            "origins": len(idx),
            "first": str(table.t[idx[0]]),
            "last": str(table.t[idx[-1]]),
        },
    ).to_dict()
    return board(views.OFFLINE, forecast, leaks_offline(table, day_starts(table.t)), made)


def save(data: dict[str, Any], engine: str) -> Path:
    p = bench_path(engine)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, separators=(",", ":")))
    return p


def load() -> dict[str, Any]:
    """The Google run's board if there is one, else the offline one, computed now if need be."""
    for engine in ("bigquery", "offline"):
        p = bench_path(engine)
        if p.is_file():
            return json.loads(p.read_text())
    data = build_offline()
    try:
        save(data, "offline")
    except OSError:
        pass
    return data


# The Google run.


def univariate_sql(
    where: Any, presets: Sequence[Preset], model: str, history: int, context: int | None
) -> str:
    """TimesFM on the loaded share alone, every origin in one query."""
    from .bigquery import _presets_cte

    table = where.table(f"metro_{CADENCE_MIN}min")
    window = f",\n  context_window => {context}" if context is not None else ""
    return f"""
WITH {_presets_cte(presets)},
past AS (
  SELECT p.preset, m.ts, m.{SIGNAL}
  FROM presets AS p
  JOIN {table} AS m
    ON m.ts >= TIMESTAMP_SUB(p.as_of, INTERVAL {history * CADENCE_MIN} MINUTE)
   AND m.ts < p.as_of
)
SELECT * FROM AI.FORECAST(
  (SELECT * FROM past),
  data_col => '{SIGNAL}',
  timestamp_col => 'ts',
  model => '{model}',
  id_cols => ['preset'],
  horizon => {HORIZON},
  confidence_level => {CONFIDENCE}{window}
)
"""


def evaluate_sql(
    where: Any, presets: Sequence[Preset], model: str, history: int, context: int | None
) -> str:
    """Google's own scores for the same origins (`AI.EVALUATE`), as a check on ours."""
    from .bigquery import _presets_cte

    table = where.table(f"metro_{CADENCE_MIN}min")
    window = f",\n  context_window => {context}" if context is not None else ""
    return f"""
WITH {_presets_cte(presets)},
past AS (
  SELECT p.preset, m.ts, m.{SIGNAL}
  FROM presets AS p
  JOIN {table} AS m
    ON m.ts >= TIMESTAMP_SUB(p.as_of, INTERVAL {history * CADENCE_MIN} MINUTE)
   AND m.ts < p.as_of
),
actual AS (
  SELECT p.preset, m.ts, m.{SIGNAL}
  FROM presets AS p
  JOIN {table} AS m
    ON m.ts >= p.as_of
   AND m.ts < TIMESTAMP_ADD(p.as_of, INTERVAL {HORIZON * CADENCE_MIN} MINUTE)
)
SELECT * FROM AI.EVALUATE(
  (SELECT * FROM past),
  (SELECT * FROM actual),
  data_col => '{SIGNAL}',
  timestamp_col => 'ts',
  model => '{model}',
  id_cols => ['preset'],
  horizon => {HORIZON}{window}
)
"""


def anomalies_all_sql(where: Any, first: np.datetime64, days: int) -> str:
    """TimesFM's anomaly check on every day: each held to the CONTEXT steps before it."""
    from .bigquery import _ts

    table = where.table(f"metro_{CADENCE_MIN}min")
    return f"""
WITH days AS (
  SELECT CAST(d AS STRING) AS day,
    TIMESTAMP_ADD({_ts(first)}, INTERVAL 24 * d HOUR) AS start
  FROM UNNEST(GENERATE_ARRAY(0, {days - 1})) AS d
),
long AS (
  SELECT y.day, m.ts, m.{SIGNAL} AS v, m.ts >= y.start AS checked
  FROM days AS y
  JOIN {table} AS m
    ON m.ts >= TIMESTAMP_SUB(y.start, INTERVAL {CONTEXT * CADENCE_MIN} MINUTE)
   AND m.ts < TIMESTAMP_ADD(y.start, INTERVAL 24 HOUR)
)
SELECT * FROM AI.DETECT_ANOMALIES(
  (SELECT day, ts, v FROM long WHERE NOT checked),
  (SELECT day, ts, v FROM long WHERE checked),
  data_col => 'v',
  timestamp_col => 'ts',
  id_cols => ['day'],
  model => '{TIMESFM_3}',
  anomaly_prob_threshold => {ANOMALY_PROB},
  context_window => {CONTEXT}
)
"""


def _status(rows: list[dict[str, Any]], key: str) -> set[str]:
    return {r.get(key) for r in rows} - {None, ""}


def parse_univariate(
    rows: list[dict[str, Any]], presets: Sequence[Preset], t: np.ndarray, idx: np.ndarray
) -> Forecasts:
    from .bigquery import _np_ts

    out = Forecasts.empty(len(presets))
    row_of = {p.id: k for k, p in enumerate(presets)}
    for r in rows:
        if r.get("ai_forecast_status"):
            continue
        k = row_of[r["preset"]]
        step = int((_np_ts(r["forecast_timestamp"]) - t[idx[k]]) / np.timedelta64(CADENCE_MIN, "m"))
        if 0 <= step < HORIZON:
            out.mid[k, step] = r["forecast_value"]
            out.lo[k, step] = r["prediction_interval_lower_bound"]
            out.hi[k, step] = r["prediction_interval_upper_bound"]
    return out


def from_bands(
    bands: dict[str, dict[str, views.Band]],
    presets: Sequence[Preset],
    t: np.ndarray,
    idx: np.ndarray,
) -> Forecasts:
    out = Forecasts.empty(len(presets))
    for k, p in enumerate(presets):
        b = bands.get(p.id, {}).get(SIGNAL)
        if b is None:
            continue
        step = ((b.t - t[idx[k]]) / np.timedelta64(CADENCE_MIN, "m")).astype(int)
        ok = (step >= 0) & (step < HORIZON)
        out.mid[k, step[ok]] = b.mid[ok]
        out.lo[k, step[ok]] = b.lo[ok]
        out.hi[k, step[ok]] = b.hi[ok]
    return out


def parse_detect(rows: list[dict[str, Any]], t: np.ndarray) -> np.ndarray:
    from .bigquery import _np_ts

    flags = np.zeros(len(t), dtype=bool)
    for r in rows:
        if r.get("ai_detect_anomalies_status") or not r.get("is_anomaly"):
            continue
        i = int(np.searchsorted(t, _np_ts(r["time_series_timestamp"])))
        if i < len(t) and t[i] == _np_ts(r["time_series_timestamp"]):
            flags[i] = True
    return flags


def run_bigquery(runner: Any) -> Path | None:
    """Every Google row of the board, under the runner's spend guard."""
    from .bigquery import forecast_sql, parse_forecast

    table = sources.metro(CADENCE_MIN)
    v, filled = table.cols[SIGNAL], table.filled
    idx = origins(table.t)
    presets = origin_presets(table.t, idx)
    w = runner.where
    dry = runner.dry_only
    sql = {
        "timesfm3_helpers": forecast_sql(w, span("day"), presets=presets),
        "timesfm3_alone": univariate_sql(w, presets, TIMESFM_3, CONTEXT, CONTEXT),
        "timesfm25_long": univariate_sql(w, presets, TIMESFM_25, LONG_CONTEXT, None),
        "evaluate3": evaluate_sql(w, presets, TIMESFM_3, CONTEXT, CONTEXT),
        "evaluate25": evaluate_sql(w, presets, TIMESFM_25, LONG_CONTEXT, None),
    }
    starts = day_starts(table.t)
    sql["anomalies"] = anomalies_all_sql(w, table.t[starts[0]], len(starts))
    rows = {k: runner.query(s, f"bench-{k}") for k, s in sql.items()}
    if dry:
        return None
    for k in ("timesfm3_alone", "timesfm25_long"):
        bad = _status(rows[k], "ai_forecast_status")
        if bad:
            print(f"  {k}: some origins not forecast: {sorted(bad)[:3]}")
    methods = {
        "timesfm3_helpers": from_bands(
            parse_forecast(rows["timesfm3_helpers"], presets), presets, table.t, idx
        ),
        "timesfm3_alone": parse_univariate(rows["timesfm3_alone"], presets, table.t, idx),
        "timesfm25_long": parse_univariate(rows["timesfm25_long"], presets, table.t, idx),
        BAR: yesterday(v, filled, idx),
    }
    actual, known = ahead(v, idx), ~ahead(filled, idx)
    leak = leak_days(table.t, idx)
    forecast = forecast_scores(actual, known, methods, {"normal": ~leak, "leak": leak})

    check = {}
    for k, key in (("evaluate3", "timesfm3_alone"), ("evaluate25", "timesfm25_long")):
        good = [r for r in rows[k] if not r.get("ai_evaluate_status")]
        mae = [float(r["mean_absolute_error"]) for r in good]
        mase = [float(r["mean_absolute_scaled_error"]) for r in good]
        check[key] = {
            "origins": len(good),
            "mean_absolute_error": float(np.mean(mae)) if mae else None,
            "mean_absolute_scaled_error": float(np.median(mase)) if mase else None,
            "note": "AI.EVALUATE: mean MAE over origins, median MASE; scores raw forecasts, filled steps included",
        }

    leaks = leaks_offline(table, starts)
    running = sources.metro_running(table.t, CADENCE_MIN)
    tfm = counted_flags(parse_detect(rows["anomalies"], table.t), filled, running)
    hour, flagged = hourly_any(table.t, tfm)
    leaks["timesfm"] = leak_score(hour, alarm_episodes(flagged, CONSECUTIVE))
    leaks = {k: leaks[k] for k in DETECTORS if k in leaks}

    made = views.Made(
        views.BIGQUERY,
        f"{TIMESFM_3} and {TIMESFM_25}",
        "BigQuery AI.FORECAST, AI.EVALUATE and AI.DETECT_ANOMALIES",
        "\n\n".join(f"-- {k}\n{s.strip()}" for k, s in sql.items()),
        {
            "origins": len(idx),
            "first": str(table.t[idx[0]]),
            "last": str(table.t[idx[-1]]),
            "days_checked": len(starts),
            "location": runner.location,
            "dataset": w.dataset,
            "offline_days": OFFLINE_DAYS,
        },
    )
    made.cost = {
        "usd": round(sum(runner.cost(f"bench-{k}").get("usd", 0.0) for k in sql), 5),
    }
    return save(board(views.BIGQUERY, forecast, leaks, made.to_dict(), check), "bigquery")
