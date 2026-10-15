"""What each Trends card receives, whichever engine computed the numbers.

An engine (BigQuery, or the offline stand-in) supplies only the model's part:
a forecast band, an anomaly band, the parts of a series, the segments that
changed. Everything around it (the history drawn, what really happened after
"as of", the leak windows) is cut from the same prepared tables here, so the
two engines differ only in the model.

Times are seconds since 1970 in the dataset's own clock, read as UTC: the
recordings carry no time zone, and the UI must not shift them. Filled steps go
out as null, so a chart breaks its line there.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import numpy as np

from . import sources
from .settings import (
    IMS_CADENCE_MIN,
    METRO_TARGETS,
    RUNNING_SHARE,
    WINDOW_AFTER_H,
    WINDOW_BEFORE_H,
    WINDOW_CADENCE_MIN,
    Preset,
    Signal,
    Span,
)

OFFLINE = "offline stand-in"
BIGQUERY = "bigquery"


def epoch(t: np.ndarray) -> list[int]:
    return (np.asarray(t, dtype="datetime64[s]").astype("int64")).tolist()


def num(x: float | None, digits: int = 4) -> float | None:
    """Rounded to `digits` significant figures; NaN and None go out as null."""
    if x is None:
        return None
    x = float(x)
    if not math.isfinite(x):
        return None
    if x == 0:
        return 0.0
    return round(x, max(0, digits - 1 - int(math.floor(math.log10(abs(x))))))


def nums(xs: Sequence[float] | np.ndarray, mask: np.ndarray | None = None) -> list[float | None]:
    out = [num(x) for x in xs]
    if mask is not None:
        out = [None if m else v for v, m in zip(out, mask, strict=True)]
    return out


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def as_of(p: Preset) -> np.datetime64:
    return np.datetime64(p.as_of, "m")


def window(p: Preset) -> tuple[np.datetime64, np.datetime64]:
    """The week the anomaly check and "what changed" look at (settings)."""
    a = as_of(p)
    return a - np.timedelta64(WINDOW_BEFORE_H, "h"), a + np.timedelta64(WINDOW_AFTER_H, "h")


def signal_meta(s: Signal) -> dict[str, str]:
    return {"id": s.id, "name": s.name, "unit": s.unit}


def failures_between(t0: np.datetime64, t1: np.datetime64) -> list[dict[str, Any]]:
    out = []
    for f in sources.metro_failures():
        a, b = np.datetime64(f["start"], "m"), np.datetime64(f["end"], "m")
        if b >= t0 and a <= t1:
            out.append(
                {
                    "start": epoch(np.array([a]))[0],
                    "end": epoch(np.array([b]))[0],
                    "label": f["label"],
                }
            )
    return out


@dataclass
class Band:
    """A model's answer for one signal: the middle and the edges, per step."""

    t: np.ndarray  # datetime64[m]
    mid: np.ndarray
    lo: np.ndarray
    hi: np.ndarray
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class Made:
    """How a view was made, for the "How this was made" box."""

    engine: str
    model: str
    product: str
    sql: str = ""
    settings: dict[str, Any] = field(default_factory=dict)
    computed_at: str = field(default_factory=now)
    cost: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "engine": self.engine,
            "model": self.model,
            "product": self.product,
            "sql": self.sql.strip(),
            "settings": self.settings,
            "computed_at": self.computed_at,
            "cost": self.cost,
        }


#: Physical limits a forecast is drawn within: a share is 0 to 100%, a current
#: is not negative. TimesFM and ARIMA_PLUS know neither, and can step past them.
LIMITS = {"loaded": (0.0, 100.0), "motor_current": (0.0, None)}


def clipped(signal: str, x: np.ndarray) -> np.ndarray:
    lo, hi = LIMITS.get(signal, (None, None))
    return np.clip(np.asarray(x, dtype=float), lo, hi) if (lo, hi) != (None, None) else x


def forecast_view(p: Preset, sp: Span, bands: dict[str, Band], made: Made) -> dict[str, Any]:
    table = sources.metro(sp.cadence_min)
    i0 = table.index(as_of(p))
    h = slice(max(0, i0 - sp.shown), i0)
    a = slice(i0, min(len(table), i0 + sp.horizon))
    signals = []
    for s in METRO_TARGETS:
        b = bands[s.id]
        signals.append(
            {
                **signal_meta(s),
                "history": {
                    "t": epoch(table.t[h]),
                    "v": nums(table.cols[s.id][h], table.filled[h]),
                },
                "actual": {"t": epoch(table.t[a]), "v": nums(table.cols[s.id][a], table.filled[a])},
                "forecast": {
                    "t": epoch(b.t),
                    "p50": nums(clipped(s.id, b.mid)),
                    "lo": nums(clipped(s.id, b.lo)),
                    "hi": nums(clipped(s.id, b.hi)),
                },
            }
        )
    made.settings.setdefault("drawn_within", "loaded share 0 to 100%, motor current from 0 A")
    end = table.t[a][-1] if a.stop > a.start else as_of(p)
    return {
        "source": "metro",
        "preset": p.id,
        "view": f"forecast-{sp.id}",
        "span": sp.id,
        "as_of": epoch(np.array([as_of(p)]))[0],
        "cadence_min": sp.cadence_min,
        "horizon": sp.horizon,
        "signals": signals,
        "failures": failures_between(table.t[h][0], end),
        "made": made.to_dict(),
    }


@dataclass
class Flags:
    """An anomaly check on one signal: the values checked and the band they were held to."""

    t: np.ndarray
    v: np.ndarray
    lo: np.ndarray
    hi: np.ndarray
    flagged: np.ndarray  # bool
    prob: np.ndarray | None = None  # the model's probability, when it gives one
    filled: np.ndarray | None = None


def anomalies_view(
    source: str,
    p: Preset,
    signals: Sequence[Signal],
    flags: dict[str, Flags],
    made: Made,
    relative: bool = False,
) -> dict[str, Any]:
    """The readings checked, the band, and which readings outside it count.

    For the compressor a reading counts only while the motor ran (settings,
    RUNNING_SHARE): the model's own flags are kept in `flagged`, the ones that
    count in `counted`, split at "as of" so a week can be held against the
    normal week's.
    """
    rows = []
    total = 0
    after = 0
    a = as_of(p) if not relative else None
    t = flags[signals[0].id].t
    running = (
        sources.metro_running(t, WINDOW_CADENCE_MIN)
        if source == "metro"
        else np.ones(len(t), dtype=bool)
    )
    for s in signals:
        f = flags[s.id]
        mask = f.filled if f.filled is not None else np.zeros(len(f.t), dtype=bool)
        flagged = f.flagged & ~mask
        idx = np.flatnonzero(flagged)
        counted = np.flatnonzero(flagged & running)
        total += len(idx)
        if a is not None:
            after += int(np.sum(f.t[idx] >= a))
        late = int(np.sum(f.t[counted] >= a)) if a is not None else None
        rows.append(
            {
                **signal_meta(s),
                "t": epoch(f.t),
                "v": nums(f.v, mask),
                "lo": nums(clipped(s.id, f.lo)),
                "hi": nums(clipped(s.id, f.hi)),
                "flagged": idx.tolist(),
                "prob": nums(f.prob) if f.prob is not None else None,
                "counted": counted.tolist(),
                "counted_before": len(counted) - (late or 0),
                "counted_after": late,
            }
        )
    if source == "metro":
        made.settings.setdefault(
            "counted", f"only while the motor ran for at least {RUNNING_SHARE:.0%} of a step"
        )
    t0, t1 = t[0], t[-1]
    counted_total = sum(len(r["counted"]) for r in rows)
    return {
        "source": source,
        "preset": p.id,
        "view": "anomalies",
        "as_of": epoch(np.array([as_of(p)]))[0] if a is not None else None,
        "relative": relative,
        # where a run's own clock starts, so a relative axis reads hours of the run
        "origin": epoch(np.array([sources.IMS_EPOCH]))[0] if relative else None,
        "cadence_min": WINDOW_CADENCE_MIN if source == "metro" else IMS_CADENCE_MIN,
        "window": {"start": epoch(np.array([t0]))[0], "end": epoch(np.array([t1]))[0]},
        "flagged": total,
        "flagged_after_as_of": after if a is not None else None,
        "counted": counted_total,
        "counted_after_as_of": sum(r["counted_after"] for r in rows) if a is not None else None,
        "not_counted_off": total - counted_total,
        "off": np.flatnonzero(~running).tolist(),
        "signals": rows,
        "failures": failures_between(t0, t1) if source == "metro" else [],
        "made": made.to_dict(),
    }


def tally(view: dict[str, Any]) -> dict[str, Any]:
    """The counted readings of an anomalies view, before and after "as of", for a comparison."""
    return {
        "preset": view["preset"],
        "before": sum(s["counted_before"] for s in view["signals"]),
        "after": view["counted_after_as_of"],
        "signals": {
            s["id"]: {"before": s["counted_before"], "after": s["counted_after"]}
            for s in view["signals"]
        },
    }


def flags_from_view(view: dict[str, Any]) -> dict[str, Flags]:
    """A saved anomalies view back into the model's answer, so it can be counted again.

    Nothing is asked of a model: the readings, the band and the model's own
    flags are all in the view. A filled step went out as null, so it comes back
    as filled.
    """

    def arr(xs: list[float | None] | None) -> np.ndarray | None:
        return None if xs is None else np.array([np.nan if x is None else x for x in xs])

    out = {}
    for s in view["signals"]:
        t = np.asarray(s["t"], dtype="datetime64[s]").astype("datetime64[m]")
        v = arr(s["v"])
        flagged = np.zeros(len(t), dtype=bool)
        flagged[s["flagged"]] = True
        out[s["id"]] = Flags(t, v, arr(s["lo"]), arr(s["hi"]), flagged, arr(s["prob"]), np.isnan(v))
    return out


def made_from(view: dict[str, Any]) -> Made:
    m = view["made"]
    return Made(
        m["engine"],
        m["model"],
        m["product"],
        m.get("sql", ""),
        dict(m.get("settings", {})),
        m.get("computed_at", now()),
        dict(m.get("cost", {})),
    )


#: The parts a breakdown may have, in the order they are drawn. A part the
#: model did not find is left out rather than drawn as a flat line.
PARTS = ("trend", "daily", "weekly", "spikes_and_dips", "step_changes", "residual")

#: Step changes listed under a breakdown: the largest few. ARIMA_PLUS finds
#: many small shifts in an hourly loaded share; the part itself is drawn whole.
STEPS_LISTED = 5


@dataclass
class Parts:
    t: np.ndarray  # history then forecast
    observed: np.ndarray
    parts: dict[str, np.ndarray]  # each over t; NaN where not defined
    forecast: Band
    model: dict[str, Any] = field(default_factory=dict)  # what the model chose


def breakdown_view(p: Preset, parts: dict[str, Parts], made: Made) -> dict[str, Any]:
    rows = []
    for s in METRO_TARGETS:
        x = parts[s.id]
        kept = {
            k: nums(v)
            for k, v in x.parts.items()
            if k in PARTS and np.any(np.isfinite(v) & (v != 0))
        }
        steps = []
        if "step_changes" in x.parts:
            sc = np.nan_to_num(x.parts["step_changes"])
            jumps = np.flatnonzero(np.abs(np.diff(sc)) > 1e-9)
            biggest = sorted(jumps, key=lambda j: -abs(sc[j + 1] - sc[j]))[:STEPS_LISTED]
            steps = [
                {"t": epoch(x.t[[j + 1]])[0], "size": num(sc[j + 1] - sc[j])}
                for j in sorted(biggest)
            ]
        rows.append(
            {
                **signal_meta(s),
                "t": epoch(x.t),
                "observed": nums(x.observed),
                "parts": kept,
                "step_list": steps,
                "forecast": {
                    "t": epoch(x.forecast.t),
                    "p50": nums(clipped(s.id, x.forecast.mid)),
                    "lo": nums(clipped(s.id, x.forecast.lo)),
                    "hi": nums(clipped(s.id, x.forecast.hi)),
                },
                "model": x.model,
            }
        )
    t0 = parts[METRO_TARGETS[0].id].t[0]
    return {
        "source": "metro",
        "preset": p.id,
        "view": "breakdown",
        "as_of": epoch(np.array([as_of(p)]))[0],
        "cadence_min": 60,
        "signals": rows,
        "failures": failures_between(t0, as_of(p) + np.timedelta64(14, "D")),
        "made": made.to_dict(),
    }


def changes_view(
    p: Preset,
    control: Preset,
    metric: str,
    overall: dict[str, float | None],
    rows: list[dict[str, Any]],
    made: Made,
) -> dict[str, Any]:
    t0, t1 = window(p)
    c0, c1 = window(control)
    return {
        "source": "metro",
        "preset": p.id,
        "view": "changes",
        "metric": metric,
        "test": {
            "start": epoch(np.array([t0]))[0],
            "end": epoch(np.array([t1]))[0],
            "label": p.label,
        },
        "control": {
            "start": epoch(np.array([c0]))[0],
            "end": epoch(np.array([c1]))[0],
            "label": control.label,
        },
        "overall": {k: num(v) for k, v in overall.items()},
        "rows": rows,
        "made": made.to_dict(),
    }


def segment_label(contributors: Sequence[str]) -> str:
    """'hour_band=00-06', 'state=loaded' -> 'night (00-06), loaded'."""
    words = []
    for c in contributors:
        _, _, value = c.partition("=")
        words.append(_WORDS.get(value, value.replace("_", " ")))
    return ", ".join(words) if words else "everything"


_WORDS = {
    "00-06": "night (00-06)",
    "06-12": "morning (06-12)",
    "12-18": "afternoon (12-18)",
    "18-24": "evening (18-24)",
    "weekday": "weekdays",
    "weekend": "weekends",
    "loaded": "running loaded",
    "idle": "running idle",
    "off": "motor off",
    "tower_0": "while drying tower 0 worked",
    "tower_1": "while drying tower 1 worked",
}


def plain_segment(label: str) -> str:
    """A saved label in today's words: a tower names a stretch of time, not a part to inspect."""
    for k in ("0", "1"):
        label = label.replace(f"dryer tower {k}", _WORDS[f"tower_{k}"])
    return label
