"""The surface a judge touches: it must work with no keys and no hardware."""

from __future__ import annotations

from fastapi.testclient import TestClient

from hypothesis_engine.api.app import app

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


def test_start_then_answer_a_measurement():
    r = client.post("/investigations", json={"fault": "misalignment"})
    assert r.status_code == 200
    state = r.json()
    assert state["hypotheses"]
    assert state["requested_tests"], "it should have asked for something"

    test_id = state["requested_tests"][0]
    r2 = client.post(
        f"/investigations/{state['id']}/evidence",
        json={"test_id": test_id, "value": 1.6},
    )
    assert r2.status_code == 200
    assert r2.json()["outcomes"][0]["test_id"] == test_id


def test_replay_runs_a_whole_case():
    r = client.post("/replay", json={"fault": "outer_race"})
    assert r.status_code == 200
    body = r.json()
    assert body["conclusion"]["root_cause"] == "outer_race"
    assert len(body["ledger"]) > 5
    assert body["transcript"]
