"""The when-to-fix forecaster, without the run-to-failure datasets.

These tests pin the mechanics: features, the watcher's causality, the trend
arithmetic, the bearing-level split and the loaders' file handling. They use
hand-built trends, so they say nothing about how well any forecaster works on
real bearings; that number comes only from `scripts/forecast.py evaluate` on the
downloaded data. The two assertions that need real files are skipped without it.
"""

from __future__ import annotations

import numpy as np
import pytest

from hypothesis_engine.forecast import health, runs
from hypothesis_engine.forecast.evaluate import leave_one_out, score_run, summarise
from hypothesis_engine.forecast.health import RunHealth, snapshot_health
from hypothesis_engine.forecast.models import (
    DANGER_FACTOR,
    AverageLife,
    Forecast,
    QuantileGBM,
    TrendExtrapolation,
    get_forecaster,
    onset_of,
    when_to_fix,
)
from hypothesis_engine.forecast.onset import BASELINE_SNAPSHOTS, CONSECUTIVE, detect_onset

FS = 25_600.0


def _run(run_id: str, life: int, onset_at: int, seed: int = 0, noise: float = 0.02) -> RunHealth:
    """A bearing that idles, then grows exponentially until its peak hits the danger line."""
    rng = np.random.default_rng(seed)
    t = np.arange(life + 1, dtype=float)
    growth = np.log(DANGER_FACTOR) / (life - onset_at)
    level = np.where(t < onset_at, 1.0, np.exp(growth * (t - onset_at)))
    rms = level * (1 + noise * rng.standard_normal(len(t)))
    peak = 4.0 * level * (1 + noise * rng.standard_normal(len(t)))
    peak[:BASELINE_SNAPSHOTS] = 4.0  # healthy maximum exactly 4, so the line is at 40
    n = len(t)
    return RunHealth(
        run_id,
        "synthetic",
        "",
        True,
        t,
        rms,
        peak,
        np.full(n, 3.0),
        peak / rms,
        np.tile([0.7, 0.2, 0.08, 0.02], (n, 1)),
    )


# --- per-snapshot health ---------------------------------------------------------


def test_sine_health_matches_closed_form() -> None:
    t = np.arange(int(FS)) / FS
    h = snapshot_health(2.0 * np.sin(2 * np.pi * 500 * t), FS)
    assert h.rms == pytest.approx(2.0 / np.sqrt(2), rel=1e-3)
    assert h.crest == pytest.approx(np.sqrt(2), rel=1e-3)
    assert h.kurtosis == pytest.approx(1.5, rel=1e-3)  # a pure sine
    assert h.band_frac[0] == pytest.approx(1.0, abs=1e-6)  # all energy below 1 kHz


def test_gaussian_noise_has_kurtosis_three_and_spread_bands() -> None:
    h = snapshot_health(np.random.default_rng(1).standard_normal(200_000), FS)
    assert h.kurtosis == pytest.approx(3.0, abs=0.05)
    assert sum(h.band_frac) <= 1.0 + 1e-9
    assert all(f > 0 for f in h.band_frac)


# --- the watcher ---------------------------------------------------------------


def test_watcher_fires_on_a_step_and_only_with_hindsight_it_had() -> None:
    hi = np.r_[np.ones(50), 2.0 * np.ones(50)] * (
        1 + 0.01 * np.random.default_rng(2).standard_normal(100)
    )
    onset = detect_onset(hi)
    assert onset == 50 + CONSECUTIVE - 1
    assert detect_onset(hi[: onset + 1]) == onset  # same answer live as in replay
    assert detect_onset(hi[:onset]) is None  # and not a snapshot earlier


def test_watcher_stays_quiet_on_noise() -> None:
    hi = 1.0 + 0.1 * np.random.default_rng(3).standard_normal(2_000)
    assert detect_onset(hi) is None


# --- forecasters -----------------------------------------------------------------


def test_trend_recovers_an_exponential_crossing() -> None:
    h = _run("a", life=200, onset_at=100, noise=0.0)
    o = onset_of(h)
    assert o is not None
    f = TrendExtrapolation().predict_many(h, [150], o)[0]
    assert f.p50 == pytest.approx(h.remaining(150), rel=0.02)
    assert f.p10 <= f.p50 <= f.p90


def test_trend_without_growth_says_not_within_what_it_has_run() -> None:
    h = _run("flat", life=200, onset_at=100, noise=0.0)
    h.peak[:] = 4.0
    f = TrendExtrapolation().predict_many(h, [150], 100)[0]
    assert f.p50 == pytest.approx(150.0)


def test_trend_over_the_line_is_due_now() -> None:
    h = _run("late", life=200, onset_at=100, noise=0.0)
    h.peak[-1] = 1_000.0
    assert TrendExtrapolation().predict_many(h, [200], 100)[0].p50 == 0.0


def test_average_life_answers_from_training_lives() -> None:
    model = AverageLife()
    model.fit([_run(f"r{k}", life=200, onset_at=100, seed=k) for k in range(5)])
    h = _run("x", life=200, onset_at=100, seed=9)
    o = onset_of(h)
    f = model.predict_many(h, [o], o)[0]
    assert f.p50 == pytest.approx(float(np.median(model.lives)), rel=1e-6)


@pytest.mark.parametrize("target", ["direct", "residual"])
def test_gbm_gives_ordered_finite_ranges(target: str) -> None:
    train = [_run(f"r{k}", life=150 + 30 * k, onset_at=60 + 10 * k, seed=k) for k in range(6)]
    model = QuantileGBM(target)
    model.fit(train)
    h = _run("held", life=210, onset_at=90, seed=42)
    o = onset_of(h)
    for f in model.predict_many(h, range(o, len(h)), o):
        assert np.isfinite([f.p10, f.p50, f.p90]).all()
        assert 0.0 <= f.p10 <= f.p50 <= f.p90


def test_saved_model_predicts_the_same(tmp_path) -> None:
    train = [_run(f"r{k}", life=150 + 30 * k, onset_at=60 + 10 * k, seed=k) for k in range(4)]
    model = QuantileGBM("residual")
    model.fit(train)
    model.save(tmp_path / "m.pkl")
    h = _run("held", life=210, onset_at=90, seed=42)
    o = onset_of(h)
    assert get_forecaster(tmp_path / "m.pkl").predict_many(h, [o, o + 20], o) == model.predict_many(
        h, [o, o + 20], o
    )


def test_without_a_model_file_the_trend_answers(tmp_path) -> None:
    assert isinstance(get_forecaster(tmp_path / "missing.pkl"), TrendExtrapolation)


def test_no_forecast_while_healthy() -> None:
    h = _run("young", life=200, onset_at=100)
    assert when_to_fix(h.prefix(60), TrendExtrapolation()) is None
    assert when_to_fix(h.prefix(160), TrendExtrapolation()) is not None


# --- evaluation ------------------------------------------------------------------


class _Spy:
    """Records what it was trained on; forecasts the truth so scores are known."""

    name = "spy"

    def __init__(self, log: list[set[str]]) -> None:
        self.log = log

    def fit(self, runs_: list[RunHealth]) -> None:
        self.log.append({h.run_id for h in runs_})

    def predict_many(self, h: RunHealth, indices, onset: int) -> list[Forecast]:
        return [
            Forecast(h.remaining(i), h.remaining(i), h.remaining(i), self.name) for i in indices
        ]


def test_held_out_bearing_is_never_in_its_own_training_set() -> None:
    bearings = [_run(f"b{k}", life=200, onset_at=100, seed=k) for k in range(5)]
    seen: list[set[str]] = []
    scores = leave_one_out(bearings, lambda: _Spy(seen))
    for trained_on, score in zip(seen, scores, strict=True):
        assert score.run_id not in trained_on
        assert len(trained_on) == len(bearings) - 1


def test_perfect_forecaster_scores_perfectly() -> None:
    s = score_run(_Spy([]), _run("p", life=200, onset_at=100))
    assert s.norm_error == 0.0 and s.coverage == 1.0 and s.late == 0.0
    assert summarise([s]).runs_scored == 1


# --- files -----------------------------------------------------------------------


def test_xjtu_files_are_ordered_by_minute_not_by_name(tmp_path) -> None:
    folder = tmp_path / "35Hz12kN" / "Bearing1_1"
    folder.mkdir(parents=True)
    for minute in (1, 2, 9, 10):
        rows = "\n".join(f"{minute + k},{-k}" for k in range(4))
        (folder / f"{minute}.csv").write_text(
            "Horizontal_vibration_signals,Vertical_vibration_signals\n" + rows
        )
    (run,) = runs.xjtu_runs(tmp_path)
    assert [f.stem for f in run.files] == ["1", "2", "9", "10"]
    assert run.times_min == (0.0, 1.0, 8.0, 9.0)
    assert run.condition == "35Hz12kN" and run.failed
    assert run.load(3) == pytest.approx([-1.5, -0.5, 0.5, 1.5])  # column 0, mean removed


def test_ims_bearings_map_to_columns_and_censored_ones_are_left_out(tmp_path) -> None:
    for test, n_cols in (("1st_test", 8), ("2nd_test", 4)):
        folder = tmp_path / test
        folder.mkdir()
        for k, stamp in enumerate(
            ("2004.02.12.10.32.39", "2004.02.12.10.42.39", "2004.02.12.10.52.39")
        ):
            row = "\t".join(str(c + 10 * k) for c in range(n_cols))
            (folder / stamp).write_text(f"{row}\n{row}\n")
    found = {r.run_id: r for r in runs.ims_runs(tmp_path)}
    assert set(found) == {"ims/test1/bearing3", "ims/test1/bearing4", "ims/test2/bearing1"}
    assert found["ims/test1/bearing3"].channel == 4
    assert found["ims/test2/bearing1"].times_min == (0.0, 10.0, 20.0)
    assert len(runs.ims_runs(tmp_path, include_censored=True)) == 8


def test_health_table_round_trips(tmp_path) -> None:
    a, b = _run("a", 50, 20, seed=1), _run("b", 60, 30, seed=2)
    health.save([a, b], tmp_path / "t.csv")
    loaded = {h.run_id: h for h in health.load(tmp_path / "t.csv")}
    assert loaded["b"].t == pytest.approx(b.t)
    assert loaded["a"].rms == pytest.approx(a.rms, rel=1e-5)
    assert loaded["a"].bands == pytest.approx(a.bands, rel=1e-5)


needs_xjtu = pytest.mark.skipif(
    not runs.xjtu_runs(), reason="needs XJTU-SY in data/xjtu/ (docs/FORECAST.md)"
)


@needs_xjtu
def test_real_xjtu_snapshot_has_the_documented_length() -> None:
    first = runs.xjtu_runs()[0]
    assert len(first.load(0)) == int(runs.XJTU_FS_HZ * 1.28)
