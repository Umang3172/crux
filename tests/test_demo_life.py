"""The synthetic pump life: the path from alarm to investigation to ticket, with no dataset.

The deployed image ships no recordings, so this life is what the maintenance tab
shows there. These tests pin that the path can be walked on it, and that it is
labelled for what it is. It is the engine run on its own signal model: nothing
here is evidence about a real machine.
"""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from hypothesis_engine.api import maintenance
from hypothesis_engine.api.app import app
from hypothesis_engine.data import demo
from hypothesis_engine.forecast import health, replay
from hypothesis_engine.forecast.models import danger_line, onset_of
from hypothesis_engine.investigation.recorded import investigate_recording
from hypothesis_engine.models import FaultKind


@pytest.fixture(scope="module")
def life() -> health.RunHealth:
    return health.build(demo.run())


@pytest.fixture
def client(tmp_path, monkeypatch):
    """The API on a server with no recorded run and no saved replay."""
    monkeypatch.setattr(replay, "REPLAY_FILE", tmp_path / "replay.json")
    maintenance._machines.cache_clear()
    maintenance._investigate.cache_clear()
    yield TestClient(app)
    maintenance._machines.cache_clear()
    maintenance._investigate.cache_clear()


def test_the_same_snapshot_is_always_the_same_capture():
    assert np.array_equal(demo.waveform(120), demo.waveform(120))
    assert not np.array_equal(demo.waveform(120), demo.waveform(121))
    with pytest.raises(IndexError):
        demo.waveform(demo.SNAPSHOTS)


def test_the_bearing_is_healthy_until_the_onset_then_wears_faster_each_minute():
    assert demo.strength(demo.ONSET - 1) == 0.0
    assert demo.strength(demo.ONSET) == pytest.approx(demo.FIRST_STRENGTH)
    assert demo.strength(demo.SNAPSHOTS - 1) == pytest.approx(demo.LAST_STRENGTH)
    steps = [demo.strength(m + 1) / demo.strength(m) for m in (110, 140, 170)]
    assert steps == pytest.approx([steps[0]] * 3), "the same factor every minute"


def test_the_watcher_alarms_on_it_and_the_life_ends_over_the_danger_line(life):
    alarm = onset_of(life)
    assert alarm is not None and demo.ONSET < alarm < demo.SNAPSHOTS - 10
    assert life.peak[-1] > danger_line(life)
    assert life.failed and life.failure_mode == "outer race"


def test_the_fault_is_named_at_the_alarm_against_the_pumps_own_normal(life):
    alarm = onset_of(life)
    state = investigate_recording(demo.DEMO_PUMP, demo.observation, alarm, demo.SNAPSHOTS)
    assert state.conclusion is not None and state.conclusion.root_cause is FaultKind.OUTER_RACE
    assert state.extra["own_normal"]["captures"] == 5


def test_against_a_textbook_machine_the_pumps_own_normal_leads_as_misalignment():
    # Why the life has quirks at all: a healthy minute, scored the old way.
    state = investigate_recording(demo.DEMO_PUMP, demo.observation, 60, demo.SNAPSHOTS, normal=())
    assert state.leader().kind is FaultKind.MISALIGNMENT
    assert state.conclusion is None, "it leads, and the engine still will not conclude on it"
    healthy = investigate_recording(demo.DEMO_PUMP, demo.observation, 60, demo.SNAPSHOTS)
    assert healthy.leader().kind is FaultKind.HEALTHY


def test_the_fault_is_named_half_an_hour_before_the_level_alarm(life):
    alarm = onset_of(life)
    early = demo.ONSET + 30
    assert early <= alarm - 30, "well before the level has doubled"
    state = investigate_recording(demo.DEMO_PUMP, demo.observation, early, demo.SNAPSHOTS)
    assert state.conclusion is not None and state.conclusion.root_cause is FaultKind.OUTER_RACE


def test_damage_too_faint_to_name_is_pointed_at_not_called_healthy():
    # Eight minutes earlier the impacts are there but fainter than the mildest
    # fault simulated. Healthy leads, the engine will not conclude on it, and it
    # says which listed fault predicts impacts at that rate.
    state = investigate_recording(demo.DEMO_PUMP, demo.observation, demo.ONSET + 22, demo.SNAPSHOTS)
    assert state.leader().kind is FaultKind.HEALTHY
    assert state.outcome == "unresolved"
    assert "Outer race predicts impacts at that rate" in state.unresolved_reason
    assert "Capture it again later" in state.unresolved_reason


def test_the_tab_can_walk_from_alarm_to_ticket_on_it(client, life):
    machines = client.get("/maintenance/machines").json()
    (pump,) = machines["machines"]
    replayed = client.get(f"/maintenance/machines/{pump['machine']}").json()
    (part,) = replayed["parts"]
    assert part["label"] == "Drive-end bearing" and part["failed"]
    assert part["alarm_h"] == pytest.approx(onset_of(life) * demo.INTERVAL_MIN / 60, abs=1e-3)
    assert replayed["end_h"] == pytest.approx(29.83, abs=0.01), (
        "thirty hours, a snapshot every ten minutes"
    )
    assert part["time_left"], "a time-left range from the alarm on"

    where = {"machine": pump["machine"], "part": part["part"], "at_h": part["alarm_h"]}
    found = client.post("/maintenance/investigate", json=where).json()
    assert found["confident"] and found["leader"]["kind"] == "outer_race"
    assert found["own_normal"]["captures"] == 5
    assert found["against_textbook"]["leader"]["kind"] == "misalignment"
    assert found["against_textbook"]["outcome"] == "unresolved"

    ticket = client.post("/maintenance/tickets", json={**where, "stop_in_h": 1}).json()
    assert "outer race" in " ".join(s["text"] for s in ticket["sentences"]).lower()
    approved = client.post(f"/maintenance/tickets/{ticket['id']}/approve", json={"by": "R"})
    assert approved.json()["status"] == "approved"
