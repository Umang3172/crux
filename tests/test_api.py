"""The surface a judge touches: it must work with no keys and no hardware."""

from __future__ import annotations

from fastapi.testclient import TestClient

from hypothesis_engine.api.app import app
from hypothesis_engine.data.rig import BENCH_RIG, rig_oracle
from hypothesis_engine.models import FaultKind

client = TestClient(app)


def test_health_reports_which_models_are_live():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert "narrator" in r.json()["models"]


def test_tests_endpoint_exposes_coaching_steps():
    r = client.get("/tests")
    assert r.status_code == 200
    body = r.json()
    assert any(t["id"] == "vib_10s" for t in body)
    assert all(t["procedure"] for t in body)


# An inner-race fault the first look cannot place and a requested capture can.
AMBIGUOUS = {"fault": "inner_race", "severity": 0.5, "extra_noise": 0.45, "seed": 555}


def test_start_then_answer_the_measurements_it_asks_for():
    r = client.post("/investigations", json=AMBIGUOUS)
    assert r.status_code == 200
    state = r.json()
    assert state["hypotheses"]
    assert state["outcome"] == "open"
    assert state["requested_tests"], "it should have asked for something"
    # The request says why this test: what the two leaders are expected to read.
    asked = state["request"]
    assert asked["test_id"] == state["requested_tests"][-1]
    assert set(asked["separates"]) <= set(asked["expected_readings"])

    # The technician's readings: new captures of the same machine in the same state.
    answers = rig_oracle(FaultKind.INNER_RACE, BENCH_RIG, severity=0.5, extra_noise=0.45)
    for _ in range(3):
        if state["outcome"] != "open":
            break
        test_id = state["requested_tests"][-1]
        r = client.post(
            f"/investigations/{state['id']}/evidence",
            json={"test_id": test_id, "value": answers(test_id)},
        )
        assert r.status_code == 200
        state = r.json()
    assert state["outcomes"][0]["test_id"] == state["requested_tests"][0]
    assert state["outcome"] == "concluded"
    assert state["conclusion"]["root_cause"] == "inner_race"


def test_a_clear_case_concludes_without_asking():
    r = client.post("/investigations", json={"fault": "misalignment"})
    body = r.json()
    assert body["outcome"] == "concluded"
    assert not body["requested_tests"]


def test_a_closed_case_takes_no_more_readings():
    state = client.post("/investigations", json={"fault": "misalignment"}).json()
    r = client.post(
        f"/investigations/{state['id']}/evidence", json={"test_id": "vib_10s", "value": 1.6}
    )
    assert r.status_code == 409


def test_replay_runs_a_whole_case():
    r = client.post("/replay", json={"fault": "outer_race"})
    assert r.status_code == 200
    body = r.json()
    assert body["conclusion"]["root_cause"] == "outer_race"
    assert len(body["ledger"]) > 5
    assert body["transcript"]
