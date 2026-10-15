"""TimesFM as a forecaster, without Google Cloud.

A stand-in query answers in place of BigQuery, so these tests pin how crossing
steps become a range, what the model is shown and what it is never shown. How
well TimesFM forecasts real bearings comes only from `scripts/forecast.py
timesfm` on the downloaded data.
"""

from __future__ import annotations

import numpy as np
import pytest

from hypothesis_engine.forecast.health import RunHealth
from hypothesis_engine.forecast.models import danger_line
from hypothesis_engine.forecast.onset import BASELINE_SNAPSHOTS
from hypothesis_engine.forecast.timesfm import (
    BATCH,
    TimesFMForecaster,
    build_sql,
    series,
)


def _run(peaks: list[float], step: float = 10.0) -> RunHealth:
    """Ten healthy snapshots at peak 1 (so the line is at 10), then `peaks`."""
    peak = np.array([1.0] * BASELINE_SNAPSHOTS + peaks)
    n = len(peak)
    return RunHealth(
        "part",
        "synthetic",
        "",
        True,
        step * np.arange(n, dtype=float),
        peak / 4,
        peak,
        np.full(n, 3.0),
        np.full(n, 4.0),
        np.tile([0.7, 0.2, 0.08, 0.02], (n, 1)),
    )


class Recorder:
    """Answers every cut with fixed steps and keeps what it was sent."""

    def __init__(self, steps=(5, 10, 20), status: str = "") -> None:
        self.steps = steps
        self.status = status
        self.calls: list[tuple[list[float], list[int], float]] = []

    def __call__(self, sql: str, v: list[float], cuts: list[int], line: float):
        self.calls.append((v, cuts, line))
        return {c: (*self.steps, self.status) for c in cuts}


def test_band_edges_become_the_range_in_minutes() -> None:
    h = _run([2.0] * 40)
    q = Recorder((5, 10, 20))
    f = TimesFMForecaster(query=q).predict_many(h, [45], 10)[0]
    # The upper edge reaches the line first: the early end. Ten-minute steps.
    assert (f.p10, f.p50, f.p90) == (50.0, 100.0, 200.0)
    assert q.calls[0][2] == pytest.approx(np.log(danger_line(h)))


def test_an_edge_that_never_reaches_the_line_is_not_within_what_it_has_run() -> None:
    h = _run([2.0] * 40)
    f = TimesFMForecaster(query=Recorder((5, None, None))).predict_many(h, [45], 10)[0]
    assert f.p10 == 50.0
    assert f.p50 == f.p90 == 450.0  # 45 snapshots of 10 minutes already run
    assert f.note


def test_over_the_line_is_due_now_and_not_asked() -> None:
    h = _run([2.0] * 20 + [50.0])
    q = Recorder()
    f = TimesFMForecaster(query=q).predict_many(h, [30], 10)[0]
    assert f.p50 == 0.0
    assert q.calls == []


def test_the_model_never_sees_past_the_latest_cut() -> None:
    h = _run([2.0] * 40 + [9.0] * 10)
    q = Recorder()
    TimesFMForecaster(query=q).predict_many(h, [20, 30], 10)
    v, cuts, _ = q.calls[0]
    assert cuts == [20, 30]
    assert len(v) == 31
    # The query itself keeps each cut's series to its own past.
    assert "s.i <= cut" in build_sql("TimesFM 2.5")


def test_ratchet_never_falls_and_its_prefix_is_the_prefix_ratchet() -> None:
    h = _run([3.0, 5.0, 2.0, 4.0, 6.0, 1.0])
    full = series(h, len(h), "ratchet")
    assert all(b >= a for a, b in zip(full, full[1:], strict=False))
    for n in range(1, len(h) + 1):
        assert series(h, n, "ratchet") == full[:n]
    assert series(h, len(h), "peak")[-1] == pytest.approx(np.log(1.0))


def test_many_cuts_go_in_batches_and_all_come_back() -> None:
    h = _run([2.0] * (BATCH + 50))
    q = Recorder()
    idx = list(range(10, len(h)))
    out = TimesFMForecaster(query=q).predict_many(h, idx, 10)
    assert len(out) == len(idx)
    assert len(q.calls) == 2


def test_a_failed_series_is_an_error_not_a_guess() -> None:
    h = _run([2.0] * 40)
    with pytest.raises(RuntimeError, match="too short"):
        TimesFMForecaster(query=Recorder(status="The time series data is too short.")).predict_many(
            h, [45], 10
        )


def test_only_offered_models_and_settings_reach_the_query() -> None:
    with pytest.raises(ValueError):
        build_sql("TimesFM 9'; DROP TABLE x; --")
    with pytest.raises(ValueError):
        build_sql("TimesFM 2.5", horizon=5000)
    with pytest.raises(ValueError):
        TimesFMForecaster(signal="kurtosis", query=Recorder())
    assert TimesFMForecaster("TimesFM 3.0", "ratchet", query=Recorder()).name == (
        "timesfm-3.0-ratchet"
    )
