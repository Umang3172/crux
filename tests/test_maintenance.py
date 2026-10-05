"""Predictive maintenance replays and their endpoints, on hand-built bearings.

Like test_forecast.py these pin mechanics, not accuracy: what a replay shows at
a moment uses only the past, a part's time-left model never trained on it, and
the endpoints answer with or without data on the server.
"""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from hypothesis_engine.api import maintenance
from hypothesis_engine.api.app import app
from hypothesis_engine.forecast import health, replay
from hypothesis_engine.forecast.models import TrendExtrapolation, onset_of
from hypothesis_engine.forecast.percent import health_percent
from test_forecast import _run, _Spy  # tests/ is on the path, not a package


def test_a_replay_shows_the_alarm_and_ranges_only_from_the_alarm_on() -> None:
    h = _run("b", life=300, onset_at=150)
    r = replay.replay_part(h, TrendExtrapolation(), chart_points=50, forecast_points=10)
    o = onset_of(h)
    assert o is not None
    assert r.alarm_h == pytest.approx(h.t[o] / 60, abs=1e-3)
    assert r.time_left and all(x.at_h >= r.alarm_h for x in r.time_left)
    assert r.end_h == pytest.approx(h.t_end / 60, abs=1e-3)
    full = health_percent(h)
    for t, p in zip(r.t_h, r.percent, strict=True):
        assert p == pytest.approx(full[int(round(t * 60))], abs=0.01)


def test_a_healthy_part_gets_no_range() -> None:
    h = _run("b", life=300, onset_at=10_000)  # never degrades
    r = replay.replay_part(h, TrendExtrapolation())
    assert r.alarm_h is None and r.time_left == []


def test_each_part_is_forecast_by_a_model_that_never_saw_it() -> None:
    parts = [_run(f"b{k}", life=200, onset_at=100, seed=k) for k in range(4)]
    seen: list[set[str]] = []
    for_part = replay.held_out(lambda: _Spy(seen), parts)
    for h in parts:
        for_part(h)
    assert len(seen) == len(parts)
    for h, trained_on in zip(parts, seen, strict=True):
        assert h.run_id not in trained_on and len(trained_on) == len(parts) - 1


@pytest.fixture
def server(tmp_path, monkeypatch):
    monkeypatch.setattr(replay, "REPLAY_FILE", tmp_path / "replay.json")
    maintenance._machines.cache_clear()
    yield tmp_path, TestClient(app)
    maintenance._machines.cache_clear()


def test_without_data_the_list_is_empty_and_says_why(server) -> None:
    _, client = server
    body = client.get("/maintenance/machines").json()
    assert body["machines"] == [] and "forecast.py table" in body["note"]


def test_endpoints_serve_every_machine_and_its_replay(server) -> None:
    tmp, client = server
    health.save(
        [_run("xjtu/c/Bearing1_1", 240, 120), _run("xjtu/c/Bearing1_2", 260, 90, seed=3)],
        tmp / "health_xjtu.csv",
    )
    rows = client.get("/maintenance/machines").json()["machines"]
    assert [r["machine"] for r in rows] == ["xjtu/c/Bearing1_1", "xjtu/c/Bearing1_2"]
    m = client.get("/maintenance/machines/xjtu/c/Bearing1_2").json()
    (part,) = m["parts"]
    assert part["label"] == "Bearing 1-2" and part["time_left"]
    assert all(np.isfinite(v) for v in part["percent"])
    assert client.get("/maintenance/machines/nope").status_code == 404
