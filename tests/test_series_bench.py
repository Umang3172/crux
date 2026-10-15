"""The Trends benchmark's scoring, on series made by hand whose answers are known.

Nothing here reads the record or calls Google: each test builds the few
numbers it needs and checks the score the rules in docs/SERIES.md give them.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from hypothesis_engine.forecast import metropt
from hypothesis_engine.series import bench, sources
from hypothesis_engine.series import bigquery as bq
from hypothesis_engine.series.settings import CONTEXT

WHERE = bq.Where("my-project-1", "crux_ts")
STEP = np.timedelta64(bench.CADENCE_MIN, "m")


def grid(start: str, days: int) -> np.ndarray:
    return np.datetime64(start, "m") + np.arange(days * bench.PER_DAY) * STEP


def hours(start: str, end: str) -> np.ndarray:
    return np.arange(np.datetime64(start, "h"), np.datetime64(end, "h"))


# Which days are scored.


def test_origins_are_8am_with_a_full_context_behind_and_a_full_day_ahead() -> None:
    t = grid("2020-02-01T00:00", 40)
    idx = bench.origins(t)
    assert len(idx) > 0
    assert all(str(t[i]).endswith("T08:00") for i in idx)
    assert idx[0] >= CONTEXT and idx[-1] + bench.HORIZON <= len(t)
    # the first 08:00 with 2,048 steps behind it, and not one before
    first_ok = next(i for i in range(len(t)) if str(t[i]).endswith("T08:00") and i >= CONTEXT)
    assert idx[0] == first_ok


def test_a_day_is_a_leak_day_when_its_next_24_hours_touch_a_reported_leak() -> None:
    t = grid("2020-05-20T00:00", 15)
    idx = np.array([i for i in range(len(t)) if str(t[i]).endswith("T08:00")])
    leak = bench.leak_days(t, idx)
    days = {str(t[i])[:10]: bool(x) for i, x in zip(idx, leak, strict=True)}
    # leak 2 runs 29 May 23:30 to 30 May 06:00
    assert days["2020-05-29"] and not days["2020-05-30"] and not days["2020-05-28"]


# Next day.


def test_the_bar_scores_one_against_itself_and_a_perfect_forecast_scores_zero() -> None:
    rng = np.random.default_rng(0)
    actual = rng.uniform(0, 80, (5, bench.HORIZON))  # room for a miss of 10 under 100%
    known = np.ones_like(actual, dtype=bool)
    bar = bench.Forecasts(actual + 10, actual, actual + 20)  # misses by 10, band below the truth
    perfect = bench.Forecasts(actual.copy(), actual - 1, actual + 1)
    s = bench.forecast_scores(
        actual, known, {"perfect": perfect, "yesterday": bar}, {"all": np.ones(5, bool)}
    )
    rows = {r["id"]: r for r in s["all"]["rows"]}
    assert rows["yesterday"]["vs_bar"] == pytest.approx(1.0)
    assert rows["yesterday"]["mae"] == pytest.approx(10.0)
    assert rows["yesterday"]["inside"] == 1.0  # its band runs from the truth up
    assert rows["perfect"]["mae"] == 0.0 and rows["perfect"]["vs_bar"] == 0.0
    assert rows["perfect"]["inside"] == 1.0


def test_a_day_any_method_missed_is_left_out_for_every_method() -> None:
    actual = np.full((3, bench.HORIZON), 50.0)
    known = np.ones_like(actual, dtype=bool)
    good = bench.Forecasts(actual + 5, actual - 10, actual + 10)
    gap = bench.Forecasts(actual + 1, actual - 10, actual + 10)
    gap.mid[1, 7] = np.nan  # one method gave no answer for day 2
    s = bench.forecast_scores(
        actual, known, {"gap": gap, "yesterday": good}, {"all": np.ones(3, bool)}
    )
    assert s["left_out"] == 1 and s["all"]["days"] == 2
    assert s["all"]["steps"] == 2 * bench.HORIZON


def test_filled_steps_are_not_scored_and_forecasts_are_scored_as_drawn() -> None:
    actual = np.full((1, bench.HORIZON), 0.0)
    known = np.ones_like(actual, dtype=bool)
    known[0, :10] = False
    below = bench.Forecasts(actual - 30, actual - 40, actual - 20)  # under 0% until clipped
    bar = bench.Forecasts(actual + 10, actual, actual + 20)
    s = bench.forecast_scores(
        actual, known, {"below": below, "yesterday": bar}, {"all": np.ones(1, bool)}
    )
    rows = {r["id"]: r for r in s["all"]["rows"]}
    assert s["all"]["steps"] == bench.HORIZON - 10
    assert rows["below"]["mae"] == 0.0  # drawn at 0%, where the truth is
    assert rows["below"]["inside"] == 1.0  # the band, clipped, is the single point 0


# Leaks.


def test_an_alarm_two_hours_after_a_report_is_caught_two_hours_late() -> None:
    hour = hours("2020-02-01T00", "2020-09-01T00")
    flagged = np.zeros(len(hour), dtype=bool)
    start = np.datetime64(metropt.FAILURES[1][0], "h")  # 29 May 23:00 as an hour
    at = int(np.flatnonzero(hour == start + np.timedelta64(2, "h"))[0])
    flagged[at - 2 : at + 1] = True  # the third flagged hour in a row is 2 h after
    s = bench.leak_score(hour, bench.alarm_episodes(flagged, 3))
    assert s["caught"] == 1 and s["before"] == 0
    assert s["leads_h"][1] == -2.0 and s["false"] == 0


def test_an_alarm_far_from_every_leak_is_a_false_alarm_and_two_flagged_hours_are_not_one() -> None:
    hour = hours("2020-02-01T00", "2020-09-01T00")
    flagged = np.zeros(len(hour), dtype=bool)
    far = int(np.flatnonzero(hour == np.datetime64("2020-03-15T00", "h"))[0])
    flagged[far : far + 3] = True
    short = int(np.flatnonzero(hour == np.datetime64("2020-08-10T00", "h"))[0])
    flagged[short : short + 2] = True  # two in a row: no alarm under the three-hour rule
    s = bench.leak_score(hour, bench.alarm_episodes(flagged, 3))
    assert s["caught"] == 0 and s["false"] == 1
    assert s["per_month"] == pytest.approx(1 / s["months"], rel=1e-2)  # months is rounded
    # the plain rule fires on its second flagged hour, so the short run counts there
    assert bench.leak_score(hour, bench.alarm_episodes(flagged, 2))["false"] == 2


def test_the_hour_rule_counts_any_flagged_step_in_the_hour() -> None:
    t = grid("2020-03-01T00:00", 1)
    flags = np.zeros(len(t), dtype=bool)
    flags[5] = True  # 01:15
    hour, flagged = bench.hourly_any(t, flags)
    assert len(hour) == 24 and flagged.tolist() == [i == 1 for i in range(24)]


def test_the_plain_rule_needs_half_an_hour_running_and_80_percent_of_it_loaded() -> None:
    t = np.datetime64("2020-03-01T00:00", "m") + np.arange(3 * 60) * np.timedelta64(1, "m")
    current = np.full(len(t), 5.0)
    loaded = np.full(len(t), 100.0)
    current[60:120] = 0.0  # hour 2: parked
    current[120:150] = 0.0  # hour 3: runs half its minutes, all of them loaded
    loaded[120:] = 100.0
    table = sources.Table(
        1, t, {"motor_current": current, "loaded": loaded}, np.zeros(len(t), bool)
    )
    _, flagged = bench.plain_hours(table)
    assert flagged.tolist() == [True, False, True]
    loaded[:60] = np.where(np.arange(60) < 47, 100.0, 0.0)  # 47 of 60 running minutes loaded
    _, flagged = bench.plain_hours(table)
    assert flagged[0] == False  # noqa: E712  47/60 is under 80%


# The Google run's SQL.


def test_the_univariate_forecast_asks_for_the_loaded_share_alone_from_each_origin() -> None:
    t = grid("2020-02-01T00:00", 30)
    presets = bench.origin_presets(t, bench.origins(t))
    sql = bench.univariate_sql(WHERE, presets, bench.TIMESFM_25, bench.LONG_CONTEXT, None)
    assert "data_col => 'loaded'" in sql and "model => 'TimesFM 2.5'" in sql
    assert "context_window" not in sql  # BigQuery picks the context that covers the history
    assert f"INTERVAL {bench.LONG_CONTEXT * bench.CADENCE_MIN} MINUTE" in sql
    assert "m.ts < p.as_of" in sql and f"horizon => {bench.HORIZON}" in sql
    for p in presets:
        assert f"'{p.id}' AS preset" in sql


def test_google_scores_the_same_origins_over_the_same_day_ahead() -> None:
    t = grid("2020-02-01T00:00", 30)
    presets = bench.origin_presets(t, bench.origins(t))
    sql = bench.evaluate_sql(WHERE, presets, bench.TIMESFM_3, CONTEXT, CONTEXT)
    assert "AI.EVALUATE(" in sql and "context_window => 2048" in sql
    assert f"INTERVAL {bench.HORIZON * bench.CADENCE_MIN} MINUTE" in sql
    assert "m.ts >= p.as_of" in sql


def test_every_day_is_held_to_the_history_before_it_began() -> None:
    sql = bench.anomalies_all_sql(WHERE, np.datetime64("2020-02-23T00:00", "m"), 190)
    assert "GENERATE_ARRAY(0, 189)" in sql
    assert "m.ts >= y.start AS checked" in sql
    assert f"INTERVAL {CONTEXT * bench.CADENCE_MIN} MINUTE" in sql
    assert "anomaly_prob_threshold => 0.95" in sql and "model => 'TimesFM 3.0'" in sql


# Serving.


def test_the_route_serves_the_google_board_and_has_none_for_the_bearing_rig(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from fastapi.testclient import TestClient

    from hypothesis_engine.api.app import app

    monkeypatch.setattr(bench, "SNAPSHOT_DIR", tmp_path)
    saved = {"source": "metro", "view": "bench", "engine": "bigquery", "leaks": []}
    bench.save(saved, "bigquery")
    client = TestClient(app)
    assert client.get("/series/metro/bench").json()["engine"] == "bigquery"
    assert client.get("/series/ims/bench").status_code == 404


def test_a_drying_tower_reads_as_a_stretch_of_time_not_a_part_to_inspect() -> None:
    from hypothesis_engine.series import views

    assert views.plain_segment("weekends, dryer tower 1") == "weekends, while drying tower 1 worked"
    assert views.segment_label(["dryer_tower=tower_0"]) == "while drying tower 0 worked"
