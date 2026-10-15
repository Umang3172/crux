"""Calibrated ranges, without the run-to-failure datasets.

Stand-in forecasters with known mistakes pin the mechanics: which way each end
moves, that p50 stays, and that no bearing sets its own correction. Whether the
correction holds on real bearings comes only from `scripts/forecast.py calibrate`.
"""

from __future__ import annotations

import numpy as np
import pytest

from hypothesis_engine.forecast.calibrate import Calibrated, weighted_quantile
from hypothesis_engine.forecast.health import RunHealth
from hypothesis_engine.forecast.models import DANGER_FACTOR, Forecast, onset_of
from hypothesis_engine.forecast.onset import BASELINE_SNAPSHOTS


def _run(run_id: str, life: int, onset_at: int) -> RunHealth:
    """Idles, then grows exponentially until its peak hits the danger line."""
    t = np.arange(life + 1, dtype=float)
    growth = np.log(DANGER_FACTOR) / (life - onset_at)
    level = np.where(t < onset_at, 1.0, np.exp(growth * (t - onset_at)))
    peak = 4.0 * level
    peak[:BASELINE_SNAPSHOTS] = 4.0
    n = len(t)
    return RunHealth(
        run_id,
        "synthetic",
        "",
        True,
        t,
        level,
        peak,
        np.full(n, 3.0),
        peak / level,
        np.tile([0.7, 0.2, 0.08, 0.02], (n, 1)),
    )


RUNS = [_run(f"b{k}", life=120 + 30 * k, onset_at=60 + 10 * k) for k in range(6)]


#: How late the stand-in is, in log(1 + minutes): a fixed factor, so the
#: correction measured on any bearings fits every other bearing exactly.
LATE = 0.5


class Late:
    """Always too late by the same factor, with no range: too late and too sure."""

    name = "late"

    def __init__(self) -> None:
        self.seen: set[str] = set()

    def fit(self, runs) -> None:
        self.seen = {h.run_id for h in runs}

    def predict_many(self, h, indices, onset):
        assert h.run_id not in self.seen, "a bearing set its own correction"
        late = [float(np.expm1(np.log1p(h.remaining(i)) + LATE)) for i in indices]
        return [Forecast(m, m, m, self.name) for m in late]


def test_weighted_quantile_counts_weight_not_points() -> None:
    x = np.array([1.0, 2.0, 3.0])
    assert weighted_quantile(x, np.array([1.0, 1.0, 1.0]), 0.5) == 2.0
    assert weighted_quantile(x, np.array([10.0, 1.0, 1.0]), 0.5) == 1.0


def test_a_late_forecaster_gets_an_earlier_p10_and_keeps_its_p50() -> None:
    cal = Calibrated(Late)
    cal.fit(RUNS[:-1])
    held = RUNS[-1]
    o = onset_of(held)
    assert o is not None
    idx = list(range(o, len(held) - 1))
    raw = Late().predict_many(held, idx, o)
    fc = cal.predict_many(held, idx, o)
    truth = np.array([held.remaining(i) for i in idx])
    assert cal.lo == pytest.approx(LATE)
    assert all(f.p10 <= t + 1e-6 for f, t in zip(fc, truth, strict=True))
    assert not any(r.p10 <= t for r, t in zip(raw, truth, strict=True))
    assert [f.p50 for f in fc] == [r.p50 for r in raw]
    assert all(f.p10 <= f.p50 <= f.p90 for f in fc)


def test_a_forecaster_that_learns_nothing_is_asked_once_per_bearing() -> None:
    calls: list[str] = []

    class Counting(Late):
        def predict_many(self, h, indices, onset):
            calls.append(h.run_id)
            return super().predict_many(h, indices, onset)

    cache: dict = {}
    for k in range(3):  # three folds sharing one cache
        Calibrated(Counting, learns=False, cache=cache).fit(
            [r for j, r in enumerate(RUNS) if j != k]
        )
    assert sorted(set(calls)) == sorted(calls)


def test_over_the_line_stays_due_now() -> None:
    class Due(Late):
        def predict_many(self, h, indices, onset):
            return [Forecast(0.0, 0.0, 0.0, self.name, "over") for _ in indices]

    cal = Calibrated(Due)
    cal.lo = cal.hi = 1.0
    f = cal.predict_many(RUNS[0], [100], 60)[0]
    assert (f.p10, f.p50, f.p90) == (0.0, 0.0, 0.0)


def test_with_no_alarm_anywhere_it_says_so() -> None:
    flat = _run("flat", life=100, onset_at=50)
    flat.rms[:] = 1.0
    with pytest.raises(ValueError):
        Calibrated(Late).fit([flat])


def test_a_saved_calibrated_model_predicts_the_same(tmp_path) -> None:
    from hypothesis_engine.forecast.calibrate import load
    from hypothesis_engine.forecast.models import QuantileGBM, get_forecaster

    cal = Calibrated(lambda: QuantileGBM("residual"))
    cal.fit(RUNS)
    cal.save(tmp_path / "m.pkl")
    back = load(tmp_path / "m.pkl")
    h = RUNS[0]
    o = onset_of(h)
    assert o is not None
    assert back.predict_many(h, [o + 5], o) == cal.predict_many(h, [o + 5], o)
    assert get_forecaster(tmp_path / "m.pkl").name == "gbm-residual-calibrated"


def test_a_part_is_told_about_the_others_never_itself() -> None:
    from hypothesis_engine.forecast.replay import MachineReplay, PartReplay, TimeLeft, with_record

    def part(name: str, held: bool, method: str = "m") -> PartReplay:
        # A part that failed at 10 h, forecast once at 5 h: 5 h left in truth.
        lo, hi = (4.0, 6.0) if held else (7.0, 9.0)
        return PartReplay(
            name, name, True, "", 10.0, 5.0, [], [], [], [TimeLeft(5.0, lo, 5.0, hi, "")], method
        )

    parts = [part("a", True), part("b", False), part("c", False), part("d", True, "other")]
    out = with_record([MachineReplay("x", "x", "", 10.0, parts)])[0].parts
    held = {p.part: (p.held_elsewhere, p.held_parts) for p in out}
    assert held["a"] == (0.0, 2)  # b and c missed; its own hit is not counted
    assert held["b"] == (0.5, 2)
    assert held["d"] == (None, 0)  # no other part on its method
