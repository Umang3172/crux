"""Offline stand-ins: the same views as BigQuery's, from simple rules, labelled as such.

They let the tab be built, tested and shown with no Google Cloud (AGENTS rule
3), and they are a floor to compare Google's models with. None of them is
tuned on the leaks. Each looks only at data before the moment it answers for:

- Forecast: the same time a day earlier (a week earlier for two weeks ahead),
  with a band from how wrong that rule was over the context.
- Anomalies: the median of the same time of day over the previous two weeks,
  plus or minus three robust standard deviations.
- Breakdown: a day-long moving average as the trend, then the average shape of
  a day and of a week, then large leftovers as spikes. It finds no step changes.
- What changed: the loaded share while running per segment, this week against
  the normal one.
- Summary: a template sentence, filled from the views.
"""

from __future__ import annotations

from itertools import combinations
from typing import Any

import numpy as np

from . import sources, views
from .settings import (
    CHANGE_DIMENSIONS,
    CONFIDENCE,
    CONTEXT,
    CONTROL_PRESET,
    IMS_CHECK_POINTS,
    IMS_MIN_HISTORY,
    IMS_SIGNALS,
    METRO_TARGETS,
    MIN_SUPPORT,
    OFF_BELOW_A,
    OFFLINE_DAYS,
    OFFLINE_K,
    TOP_CHANGES,
    WINDOW_CADENCE_MIN,
    Preset,
    Span,
    preset,
    span,
)

#: A robust spread of zero (a motor that is always off at 3 am) would flag any
#: change at all. The spread is floored at this share of the signal's usual
#: range (5th to 95th percentile of the history used). The stand-in still flags
#: about a quarter of the normal week's points, mostly oil temperature drifting
#: from its two-week median: it is a floor to compare with, not a detector.
SPREAD_FLOOR = 0.02

_MAD = 1.4826  # MAD to standard deviation, for normal noise
_Q = (1 - CONFIDENCE) / 2


def _made(model: str, product: str, **settings: Any) -> views.Made:
    return views.Made(views.OFFLINE, model, product, "", settings)


def seasonal_band(
    v: np.ndarray, filled: np.ndarray, i0: int, horizon: int, period: int
) -> tuple[np.ndarray, ...]:
    """Forecast from step i0 by repeating the last period; band from that rule's past errors."""
    hist = v[:i0]
    mid = np.empty(horizon)
    for k in range(horizon):
        back = i0 + k - period
        mid[k] = hist[back] if back < i0 else mid[back - i0]
    ctx = np.arange(max(period, i0 - CONTEXT), i0)
    ok = ~filled[ctx] & ~filled[ctx - period]
    err = v[ctx][ok] - v[ctx - period][ok]
    lo_e, hi_e = np.quantile(err, [_Q, 1 - _Q]) if len(err) else (0.0, 0.0)
    return mid, mid + lo_e, mid + hi_e


def forecast(p: Preset, sp: Span) -> dict[str, Any]:
    table = sources.metro(sp.cadence_min)
    i0 = table.index(views.as_of(p))
    period = (7 if sp.id == "2w" else 1) * 24 * 60 // sp.cadence_min
    t = table.t[0] + (i0 + np.arange(sp.horizon)).astype("timedelta64[m]") * sp.cadence_min
    bands = {}
    for s in METRO_TARGETS:
        mid, lo, hi = seasonal_band(table.cols[s.id], table.filled, i0, sp.horizon, period)
        bands[s.id] = views.Band(t, mid, lo, hi)
    rule = "same time a week earlier" if sp.id == "2w" else "same time a day earlier"
    made = _made(
        f"stand-in for {sp.model}: {rule}",
        "none (offline)",
        horizon=sp.horizon,
        cadence_min=sp.cadence_min,
        band=f"{_Q:.0%} to {1 - _Q:.0%} of that rule's errors over the last {CONTEXT} steps",
    )
    return views.forecast_view(p, sp, bands, made)


def _band_by_slot(
    v: np.ndarray, filled: np.ndarray, start: int, n: int, per_day: int
) -> tuple[np.ndarray, np.ndarray]:
    """Median and spread of each time of day over the OFFLINE_DAYS days before `start`."""
    lo_i = max(0, start - OFFLINE_DAYS * per_day)
    hist, hf = v[lo_i:start], filled[lo_i:start]
    slots = (np.arange(lo_i, start)) % per_day
    good = hist[~hf]
    span_ = float(np.subtract(*np.percentile(good, [95, 5]))) if len(good) else 0.0
    med = np.full(per_day, np.nan)
    sd = np.full(per_day, np.nan)
    for s in range(per_day):
        x = hist[(slots == s) & ~hf]
        if len(x):
            med[s] = np.median(x)
            sd[s] = _MAD * np.median(np.abs(x - med[s]))
    sd = np.maximum(np.nan_to_num(sd), SPREAD_FLOOR * span_)
    k = (start + np.arange(n)) % per_day
    return med[k], sd[k]


def anomalies(source: str, p: Preset) -> dict[str, Any]:
    if source == "ims":
        return _ims_anomalies(p)
    table = sources.metro(WINDOW_CADENCE_MIN)
    t0, t1 = views.window(p)
    a, b = table.index(t0), table.index(t1)
    per_day = 24 * 60 // WINDOW_CADENCE_MIN
    flags = {}
    for s in METRO_TARGETS:
        v = table.cols[s.id]
        med, sd = _band_by_slot(v, table.filled, a, b - a, per_day)
        lo, hi = med - OFFLINE_K * sd, med + OFFLINE_K * sd
        x = v[a:b]
        flags[s.id] = views.Flags(
            table.t[a:b], x, lo, hi, (x < lo) | (x > hi), None, table.filled[a:b]
        )
    made = _made(
        "stand-in for TimesFM 3.0: median of the same time of day",
        "none (offline)",
        history_days=OFFLINE_DAYS,
        k=OFFLINE_K,
        cadence_min=WINDOW_CADENCE_MIN,
    )
    return views.anomalies_view("metro", p, METRO_TARGETS, flags, made)


def _ims_anomalies(p: Preset) -> dict[str, Any]:
    run = sources.ims_runs()[p.id]
    n = len(run.minutes)
    start = sources.ims_check_start(n, IMS_CHECK_POINTS, IMS_MIN_HISTORY)
    t = sources.ims_time(n)
    flags = {}
    for s in IMS_SIGNALS:
        v = run.cols[s.id]
        hist = v[max(0, start - CONTEXT) : start]
        med = float(np.median(hist))
        sd = max(_MAD * float(np.median(np.abs(hist - med))), 1e-12)
        lo = np.full(n - start, med - OFFLINE_K * sd)
        hi = np.full(n - start, med + OFFLINE_K * sd)
        x = v[start:]
        flags[s.id] = views.Flags(t[start:], x, lo, hi, (x < lo) | (x > hi))
    made = _made(
        "stand-in for TimesFM 3.0: median of the run's history",
        "none (offline)",
        k=OFFLINE_K,
        checked_points=n - start,
    )
    return views.anomalies_view("ims", p, IMS_SIGNALS, flags, made, relative=True)


def _moving_average(v: np.ndarray, width: int) -> np.ndarray:
    pad = width // 2
    x = np.concatenate([np.full(pad, v[0]), v, np.full(width - pad - 1, v[-1])])
    return np.convolve(x, np.ones(width) / width, mode="valid")


def breakdown(p: Preset) -> dict[str, Any]:
    sp = span("2w")
    table = sources.metro(60)
    i0 = table.index(views.as_of(p))
    shown = slice(max(0, i0 - sp.shown), i0)
    fc = forecast(p, sp)
    n_fc = sp.horizon
    fh = np.arange(i0, i0 + n_fc)
    t_all = np.concatenate(
        [table.t[shown], table.t[0] + (i0 + np.arange(n_fc)).astype("timedelta64[h]")]
    )

    def joined(hist: np.ndarray, ahead: np.ndarray | None) -> np.ndarray:
        return np.concatenate([hist[shown], ahead if ahead is not None else np.full(n_fc, np.nan)])

    parts = {}
    for s, f in zip(METRO_TARGETS, fc["signals"], strict=True):
        v = table.cols[s.id][:i0]
        trend = _moving_average(v, 24)
        rest = v - trend
        hours = np.arange(i0) % 24
        dows = (np.arange(i0) // 24 + 5) % 7  # 1 Feb 2020 was a Saturday
        recent = np.arange(i0) >= i0 - 28 * 24
        daily_shape = np.array([rest[recent & (hours == h)].mean() for h in range(24)])
        daily = daily_shape[hours]
        rest2 = rest - daily
        weekly_shape = np.array([rest2[recent & (dows == d)].mean() for d in range(7)])
        weekly = weekly_shape[dows]
        resid = rest2 - weekly
        mad = _MAD * np.median(np.abs(resid[recent]))
        spikes = np.where(np.abs(resid) > 4 * max(mad, 1e-9), resid, 0.0)
        resid = resid - spikes
        observed = np.concatenate(
            [np.where(table.filled[shown], np.nan, v[shown]), np.full(n_fc, np.nan)]
        )
        parts[s.id] = views.Parts(
            t_all,
            observed,
            {
                "trend": joined(trend, np.full(n_fc, trend[-1])),
                "daily": joined(daily, daily_shape[fh % 24]),
                "weekly": joined(weekly, weekly_shape[(fh // 24 + 5) % 7]),
                "spikes_and_dips": joined(spikes, None),
                "residual": joined(resid, None),
            },
            views.Band(
                t_all[-n_fc:],
                np.array(f["forecast"]["p50"], dtype=float),
                np.array(f["forecast"]["lo"], dtype=float),
                np.array(f["forecast"]["hi"], dtype=float),
            ),
            {"method": "moving average, average day, average week"},
        )
    made = _made(
        "stand-in for ARIMA_PLUS: moving average and average day and week",
        "none (offline)",
        trend_window_h=24,
        shape_from_days=28,
        spikes_beyond=4,
    )
    return views.breakdown_view(p, parts, made)


def dimensions(table: sources.Table, a: int, b: int) -> dict[str, np.ndarray]:
    """The segments each minute belongs to (settings.CHANGE_DIMENSIONS)."""
    t = table.t[a:b]
    hour = (t - t.astype("datetime64[D]")).astype("timedelta64[h]").astype(int)
    dow = (t.astype("datetime64[D]").astype(int) + 3) % 7  # 0 = Monday (1 Jan 1970 was a Thursday)
    bands = np.array(["00-06", "06-12", "12-18", "18-24"])
    return {
        "hour_band": bands[hour // 6],
        "day_type": np.where(dow >= 5, "weekend", "weekday"),
        "dryer_tower": np.where(table.cols["towers"][a:b] >= 0.5, "tower_1", "tower_0"),
    }


def changes(p: Preset) -> dict[str, Any]:
    control = preset("metro", CONTROL_PRESET)
    table = sources.metro(1)

    def week(q: Preset) -> tuple[dict[str, np.ndarray], np.ndarray]:
        t0, t1 = views.window(q)
        a, b = table.index(t0), table.index(t1)
        keep = ~table.filled[a:b] & (table.cols["motor_current"][a:b] >= OFF_BELOW_A)
        dims = {k: v[keep] for k, v in dimensions(table, a, b).items()}
        return dims, table.cols["loaded"][a:b][keep]

    td, tv = week(p)
    cd, cv = week(control)
    overall = {"test": float(tv.mean()), "control": float(cv.mean())}
    rows = []
    for r in (1, 2):
        for dims in combinations(CHANGE_DIMENSIONS, r):
            for vals in sorted(set(zip(*(td[d] for d in dims), strict=True))):
                tm = np.all([td[d] == v for d, v in zip(dims, vals, strict=True)], axis=0)
                cm = np.all([cd[d] == v for d, v in zip(dims, vals, strict=True)], axis=0)
                support = max(tm.mean(), cm.mean())
                if support < MIN_SUPPORT or not tm.any() or not cm.any():
                    continue
                mt, mc = float(tv[tm].mean()), float(cv[cm].mean())
                contributors = [f"{d}={v}" for d, v in zip(dims, vals, strict=True)]
                rows.append(
                    {
                        "contributors": contributors,
                        "label": views.segment_label(contributors),
                        "test": views.num(mt),
                        "control": views.num(mc),
                        "ratio": views.num(mt / mc) if mc else None,
                        "attribution": views.num((mt - mc) * float(tm.mean())),
                        "support": views.num(support),
                    }
                )
    rows.sort(key=lambda r: -abs(r["attribution"] or 0))
    made = _made(
        "stand-in for contribution analysis: mean per segment",
        "none (offline)",
        metric="loaded share while running (%)",
        dimensions=list(CHANGE_DIMENSIONS),
        min_support=MIN_SUPPORT,
        attribution="(test mean - control mean) x the segment's share of the test week",
    )
    return views.changes_view(p, control, METRIC, overall, rows[:TOP_CHANGES], made)


METRIC = "Loaded share while running (%)"


def ims_ready(p: Preset) -> bool:
    return p.id in sources.ims_runs()
