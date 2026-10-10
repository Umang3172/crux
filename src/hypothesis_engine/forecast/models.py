"""Forecasters: how long until this bearing's vibration crosses the danger line.

Every forecaster answers with a range (10th, 50th and 90th percentile, in
minutes), never a single date, and only after the watcher has seen the level
leave healthy (forecast/onset.py). None of them reads the investigation's
beliefs or writes to them: the diagnosis says *what*, this says *when*.

- `TrendExtrapolation` fits the recent growth of the peak level and extends it
  to the danger line. It needs no training and only numpy, so it is the
  fallback whenever the learned model is missing.
- `AverageLife` ignores the signal and answers from how long the training
  bearings lasted after their onset. Anything worth shipping must beat it.
- `QuantileGBM` learns from the training bearings with gradient-boosted trees,
  one per percentile. `target="direct"` learns the minutes left; `"residual"`
  learns how wrong the trend extrapolation tends to be, which is unit-free and
  so has a chance of carrying over to a rig with a different time scale.
"""

from __future__ import annotations

import pickle
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

from ..data.root import DATA_ROOT
from .health import RunHealth
from .onset import BASELINE_SNAPSHOTS, baseline, detect_onset

#: The danger line, as a multiple of the largest amplitude seen while healthy.
#: XJTU-SY declares a bearing failed when its vibration amplitude exceeds 10x the
#: maximum of its normal operating stage (Wang et al., IEEE Trans. Reliability
#: 69(1), 2020, as restated in PMC9919518; secondary). On IMS the same rule is
#: applied for consistency; it is not IMS's own failure criterion.
DANGER_FACTOR = 10.0

#: Recent snapshots the trend is fitted over. Chosen: long enough to average out
#: snapshot-to-snapshot scatter, short enough to follow the faster growth of a
#: late-stage fault.
TREND_WINDOW = 15

#: z for the 10th/90th percentile of a normal distribution.
Z90 = 1.2816

QUANTILES = (0.1, 0.5, 0.9)


@dataclass(frozen=True)
class Forecast:
    """Minutes until the danger line: likely no sooner than p10, no later than p90."""

    p10: float
    p50: float
    p90: float
    method: str
    note: str = ""


class Forecaster(Protocol):
    name: str

    def fit(self, runs: Sequence[RunHealth]) -> None: ...

    def predict_many(self, h: RunHealth, indices: Sequence[int], onset: int) -> list[Forecast]: ...


def danger_line(h: RunHealth) -> float:
    return DANGER_FACTOR * float(np.max(h.peak[:BASELINE_SNAPSHOTS]))


def onset_of(h: RunHealth) -> int | None:
    """The watcher runs on RMS: a steadier level than the peak, so fewer false alarms."""
    return detect_onset(h.rms)


def _ordered(q: np.ndarray) -> tuple[float, float, float]:
    """Independently fitted percentiles can cross; a range must not."""
    lo, mid, hi = np.sort(np.maximum(q, 0.0))
    return float(lo), float(mid), float(hi)


class TrendExtrapolation:
    """Fit log(peak) against time over the recent window and extend it to the line.

    A straight line in log space is exponential growth, the usual shape of
    bearing degradation once a defect starts to spread. The slope's standard
    error gives the range: a faster plausible slope is the early end (p10).
    """

    name = "trend"

    def __init__(self, window: int = TREND_WINDOW) -> None:
        self.window = window

    def fit(self, runs: Sequence[RunHealth]) -> None:  # nothing to learn
        return None

    def _one(self, h: RunHealth, i: int, onset: int) -> Forecast:
        line = danger_line(h)
        if h.peak[i] >= line:
            return Forecast(0.0, 0.0, 0.0, self.name, "already over the danger line")
        start = max(0, min(max(onset, i - self.window + 1), i - 2))
        t = h.t[start : i + 1]
        y = np.log(np.maximum(h.peak[start : i + 1], 1e-12))
        # With no measurable growth there is nothing to extend. The honest
        # statement is "not within the time it has already run", so that is the cap.
        cap = max(float(h.t[i] - h.t[0]), 1.0)
        tc = t - t.mean()
        sxx = float(np.sum(tc**2))
        if sxx <= 0:
            return Forecast(cap, cap, cap, self.name, "no spread in time to fit")
        slope = float(np.sum(tc * (y - y.mean())) / sxx)
        resid = y - (y.mean() + slope * tc)
        dof = max(len(t) - 2, 1)
        se = float(np.sqrt(np.sum(resid**2) / dof / sxx))
        y_now = y.mean() + slope * (t[-1] - t.mean())
        gap = float(np.log(line) - y_now)
        if gap <= 0:
            return Forecast(0.0, 0.0, 0.0, self.name, "trend already at the danger line")

        def crossing(s: float) -> float:
            return min(gap / s, cap) if s > 0 else cap

        return Forecast(
            crossing(slope + Z90 * se),
            crossing(slope),
            crossing(slope - Z90 * se),
            self.name,
        )

    def predict_many(self, h: RunHealth, indices: Sequence[int], onset: int) -> list[Forecast]:
        return [self._one(h, i, onset) for i in indices]


class AverageLife:
    """How long the training bearings lasted after onset, given this one has lasted tau."""

    name = "average-life"

    def __init__(self) -> None:
        self.lives: np.ndarray = np.array([])

    def fit(self, runs: Sequence[RunHealth]) -> None:
        lives = []
        for h in runs:
            o = onset_of(h)
            if h.failed and o is not None:
                lives.append(h.t_end - float(h.t[o]))
        self.lives = np.array(lives)

    def predict_many(self, h: RunHealth, indices: Sequence[int], onset: int) -> list[Forecast]:
        out = []
        for i in indices:
            tau = float(h.t[i] - h.t[onset])
            left = self.lives[self.lives > tau] - tau
            if len(left) == 0:
                out.append(Forecast(0.0, 0.0, 0.0, self.name, "outlived every training bearing"))
                continue
            out.append(Forecast(*_ordered(np.quantile(left, QUANTILES)), self.name))
        return out


def _slope(t: np.ndarray, y: np.ndarray) -> float:
    if len(t) < 2:
        return 0.0
    tc = t - t.mean()
    sxx = float(np.sum(tc**2))
    return float(np.sum(tc * (y - y.mean())) / sxx) if sxx > 0 else 0.0


FEATURES = (
    "log_rms_rise",  # log(rms / healthy rms)
    "log_peak_to_line",  # log(peak / danger line); 0 means on the line
    "slope_short",  # d log(rms) / d minute over the last 5 snapshots
    "slope_long",  # same over the last TREND_WINDOW snapshots
    "kurtosis",
    "crest",
    "high_band_share",  # energy above 3 kHz
    "log_trend_p50",  # what TrendExtrapolation says, in log minutes
    "log_minutes_since_onset",
)


def features(h: RunHealth, i: int, onset: int, trend: Forecast) -> np.ndarray:
    """What the learned model sees at snapshot i: snapshots 0..i only."""
    base = baseline(h.rms)
    lo = max(0, i - 2)  # median of 3 calms single-snapshot spikes
    rms = float(np.median(h.rms[lo : i + 1]))
    peak = float(np.median(h.peak[lo : i + 1]))
    log_rms = np.log(np.maximum(h.rms[: i + 1], 1e-12))
    s5 = max(0, i - 4)
    sw = max(0, i - TREND_WINDOW + 1)
    return np.array(
        [
            np.log(max(rms, 1e-12) / max(base.mean, 1e-12)),
            np.log(max(peak, 1e-12) / max(danger_line(h), 1e-12)),
            _slope(h.t[s5 : i + 1], log_rms[s5:]),
            _slope(h.t[sw : i + 1], log_rms[sw:]),
            float(np.median(h.kurtosis[lo : i + 1])),
            float(np.median(h.crest[lo : i + 1])),
            float(np.sum(h.bands[i, 2:])),
            np.log1p(trend.p50),
            np.log1p(float(h.t[i] - h.t[onset])),
        ]
    )


class QuantileGBM:
    """Gradient-boosted trees, one per percentile, on the features above.

    Each training bearing gets the same total weight however many snapshots it
    has, so one long run cannot outvote the rest.
    """

    name = "gbm"

    def __init__(self, target: str = "residual", seed: int = 0) -> None:
        if target not in ("direct", "residual"):
            raise ValueError("target is 'direct' or 'residual'")
        self.target = target
        self.seed = seed
        self.name = f"gbm-{target}"
        self.trend = TrendExtrapolation()
        self.models: list[object] = []

    def _rows(self, h: RunHealth, indices: Sequence[int], onset: int):
        trends = self.trend.predict_many(h, indices, onset)
        X = np.array([features(h, i, onset, tr) for i, tr in zip(indices, trends, strict=True)])
        return X, trends

    def fit(self, runs: Sequence[RunHealth]) -> None:
        from sklearn.ensemble import HistGradientBoostingRegressor

        Xs, ys, ws = [], [], []
        for h in runs:
            o = onset_of(h)
            if not h.failed or o is None:
                continue
            idx = list(range(o, len(h)))
            X, trends = self._rows(h, idx, o)
            y = np.log1p([h.remaining(i) for i in idx])
            if self.target == "residual":
                y = y - np.log1p([tr.p50 for tr in trends])
            Xs.append(X)
            ys.append(y)
            ws.append(np.full(len(idx), 1.0 / len(idx)))
        if not Xs:
            raise ValueError("no failed training run ever left its healthy level")
        X, y, w = np.vstack(Xs), np.concatenate(ys), np.concatenate(ws)
        self.models = [
            HistGradientBoostingRegressor(
                loss="quantile",
                quantile=q,
                max_iter=300,
                learning_rate=0.05,
                max_leaf_nodes=15,
                min_samples_leaf=20,
                random_state=self.seed,
            ).fit(X, y, sample_weight=w)
            for q in QUANTILES
        ]

    def predict_many(self, h: RunHealth, indices: Sequence[int], onset: int) -> list[Forecast]:
        if not self.models:
            raise RuntimeError("fit() first, or load a saved model")
        indices = list(indices)
        X, trends = self._rows(h, indices, onset)
        q = np.column_stack([m.predict(X) for m in self.models])  # type: ignore[attr-defined]
        if self.target == "residual":
            q = q + np.log1p([[tr.p50] for tr in trends])
        return [
            Forecast(*_ordered(np.expm1(row)), self.name)
            if tr.p50 > 0
            else Forecast(0.0, 0.0, 0.0, self.name, tr.note)
            for row, tr in zip(q, trends, strict=True)
        ]

    def save(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with Path(path).open("wb") as fh:
            pickle.dump({"target": self.target, "seed": self.seed, "models": self.models}, fh)

    @classmethod
    def load(cls, path: str | Path) -> QuantileGBM:
        # A pickle can run code when loaded: only load a file you built yourself.
        with Path(path).open("rb") as fh:
            state = pickle.load(fh)
        model = cls(state["target"], state["seed"])
        model.models = state["models"]
        return model


DEFAULT_MODEL = DATA_ROOT / "forecast" / "model.pkl"


def get_forecaster(path: str | Path | None = None) -> Forecaster:
    """The learned model if it was trained and scikit-learn is installed, else the trend."""
    p = Path(path) if path is not None else DEFAULT_MODEL
    if p.exists():
        try:
            return QuantileGBM.load(p)
        except ImportError:
            pass
    return TrendExtrapolation()


def when_to_fix(h: RunHealth, forecaster: Forecaster | None = None) -> Forecast | None:
    """The live question, at the latest snapshot. None while the bearing still looks healthy."""
    o = onset_of(h)
    if o is None:
        return None
    return (forecaster or get_forecaster()).predict_many(h, [len(h) - 1], o)[0]
