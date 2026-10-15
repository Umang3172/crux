"""Widen a forecaster's range until it holds what it claims, on bearings it never saw.

Every forecaster here answers p10..p90, a range that should hold the truth 80%
of the time. On XJTU-SY held-out bearings none does: the shipped model's range
holds it 42% of the time (docs/FORECAST.md). This is conformalised quantile
regression (Romano, Patterson and Candes, NeurIPS 2019), done by bearing:

1. Leave out one training bearing at a time, fit on the rest, and forecast the
   one left out, so every score comes from a bearing the model never saw.
2. Score how far the truth fell outside each end, in log(1 + minutes), so being
   an hour out matters less when the answer is a day.
3. Move each end by the score that 90% of moments fell within; p50 stays.

Each bearing weighs the same however many snapshots it has, as in
`evaluate.py`. The textbook guarantee needs exchangeable points; moments of one
bearing are not, so this is a correction measured on held-out bearings, not a
guarantee. Only the held-out test says whether it worked.
"""

from __future__ import annotations

import pickle
from collections.abc import Callable, Sequence
from pathlib import Path

import numpy as np

from .health import RunHealth
from .models import Forecast, Forecaster, QuantileGBM, onset_of

#: Share of moments each end may miss: 0.1 below p10, 0.1 above p90.
ALPHA = 0.1


def weighted_quantile(x: np.ndarray, w: np.ndarray, q: float) -> float:
    """The smallest value with at least share q of the weight at or below it."""
    order = np.argsort(x)
    x, w = x[order], w[order]
    cum = np.cumsum(w) / np.sum(w)
    return float(x[min(int(np.searchsorted(cum, q)), len(x) - 1)])


def _log(m: np.ndarray | float) -> np.ndarray:
    return np.log1p(np.maximum(m, 0.0))


class Calibrated:
    """`make()`'s forecaster with each end moved by what held-out bearings showed.

    `learns=False` is for a forecaster whose `fit` does nothing (the trend,
    TimesFM): its forecasts do not depend on the training set, so each bearing
    is forecast once and kept in `cache`, which the caller may share across folds.
    """

    def __init__(
        self,
        make: Callable[[], Forecaster],
        learns: bool = True,
        alpha: float = ALPHA,
        cache: dict[str, list[Forecast]] | None = None,
    ) -> None:
        self.make = make
        self.learns = learns
        self.alpha = alpha
        self.cache = cache if cache is not None else {}
        self.model = make()
        self.name = f"{self.model.name}-calibrated"
        self.lo = 0.0  # added below p10, in log(1 + minutes)
        self.hi = 0.0  # added above p90

    def _held_out(self, runs: Sequence[RunHealth], j: int) -> list[Forecast]:
        h = runs[j]
        o = onset_of(h)
        assert o is not None
        if not self.learns and h.run_id in self.cache:
            return self.cache[h.run_id]
        m = self.make()
        m.fit([r for k, r in enumerate(runs) if k != j])
        fc = m.predict_many(h, range(o, len(h)), o)
        if not self.learns:
            self.cache[h.run_id] = fc
        return fc

    def fit(self, runs: Sequence[RunHealth]) -> None:
        runs = [h for h in runs if h.failed and onset_of(h) is not None]
        lo_s, hi_s, ws = [], [], []
        for j, h in enumerate(runs):
            o = onset_of(h)
            assert o is not None
            fc = self._held_out(runs, j)
            truth = _log(np.array([h.remaining(i) for i in range(o, len(h))]))
            lo_s.append(_log(np.array([f.p10 for f in fc])) - truth)
            hi_s.append(truth - _log(np.array([f.p90 for f in fc])))
            ws.append(np.full(len(fc), 1.0 / len(fc)))
        if not ws:
            raise ValueError("no failed training run ever left its healthy level")
        w = np.concatenate(ws)
        self.lo = weighted_quantile(np.concatenate(lo_s), w, 1 - self.alpha)
        self.hi = weighted_quantile(np.concatenate(hi_s), w, 1 - self.alpha)
        self.model.fit(runs)

    def predict_many(self, h: RunHealth, indices: Sequence[int], onset: int) -> list[Forecast]:
        indices = list(indices)
        whole = indices == list(range(onset, len(h)))
        if not self.learns and whole and h.run_id in self.cache:
            base = self.cache[h.run_id]
        else:
            base = self.model.predict_many(h, indices, onset)
            if not self.learns and whole:
                self.cache[h.run_id] = base
        out = []
        for f in base:
            if f.p90 <= 0:  # already over the line: nothing to widen
                out.append(Forecast(f.p10, f.p50, f.p90, self.name, f.note))
                continue
            p10 = float(np.expm1(max(_log(f.p10) - self.lo, 0.0)))
            p90 = float(np.expm1(_log(f.p90) + self.hi))
            out.append(Forecast(min(p10, f.p50), f.p50, max(p90, f.p50), self.name, f.note))
        return out

    def save(self, path: str | Path) -> None:
        """Only the learned model is saved: the trend has nothing to keep but two offsets."""
        if not isinstance(self.model, QuantileGBM):
            raise TypeError("only a calibrated QuantileGBM is saved")
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        state = {
            "target": self.model.target,
            "seed": self.model.seed,
            "models": self.model.models,
            "lo": self.lo,
            "hi": self.hi,
            "alpha": self.alpha,
        }
        with Path(path).open("wb") as fh:
            pickle.dump(state, fh)


def load(path: str | Path) -> Forecaster:
    """A saved model, calibrated if it was saved with its offsets."""
    # A pickle can run code when loaded: only load a file you built yourself.
    with Path(path).open("rb") as fh:
        state = pickle.load(fh)
    model = QuantileGBM(state["target"], state["seed"])
    model.models = state["models"]
    if "lo" not in state:
        return model
    cal = Calibrated(lambda: QuantileGBM(state["target"], state["seed"]), alpha=state["alpha"])
    cal.model = model
    cal.lo, cal.hi = state["lo"], state["hi"]
    return cal
