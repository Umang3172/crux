"""The surface a judge touches: it must work with no keys and no hardware."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from hypothesis_engine.api.app import app
from hypothesis_engine.data.rig import BENCH_RIG, rig_oracle
from hypothesis_engine.models import FaultKind
from hypothesis_engine.physics.frequencies import bearing_multipliers

client = TestClient(app)


def test_health_reports_which_models_are_live():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    models = r.json()["models"]
    assert {"investigator", "report_writer", "ticket_writer"} <= set(models)
    assert "narrator" not in models, "a role nothing calls is not listed as running"


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


def test_a_healthy_verdict_carries_what_it_could_not_have_seen_as_data():
    body = client.post("/replay", json={"fault": "healthy", "seed": 1234}).json()
    verdict = body["conclusion"]
    assert verdict["root_cause"] == "healthy"

    unseen = verdict["cannot_exclude"]
    assert unseen, "this capture cannot rule a mild imbalance out"
    for item in unseen:
        named = f"{item['kind'].replace('_', ' ')} at severity {item['severity']:g}"
        assert named in verdict["limit"], "the sentence and the data say the same thing"
    # The screen must not call one of these ruled out: it is marked rejected here,
    # which is a statement about the suspect at every strength, not about a mild one.
    rejected = {h["kind"] for h in body["hypotheses"] if h["rejected"]}
    assert {item["kind"] for item in unseen} & rejected


def test_the_machine_route_gives_the_spec_and_the_rates_the_physics_computes():
    body = client.get("/machine").json()
    rates = body["per_shaft_turn"]
    assert rates == bearing_multipliers(BENCH_RIG.bearing)
    assert body["blade_count"] == BENCH_RIG.blade_count
    assert body["nominal_rpm"] == BENCH_RIG.nominal_rpm

    # Two identities every rolling bearing obeys, so a drawing made from these
    # numbers shows a ball meeting each ring at the rate the engine looks for.
    balls = body["bearing"]["rolling_elements"]
    assert balls == BENCH_RIG.bearing.n_rolling_elements
    assert rates["bpfo"] + rates["bpfi"] == pytest.approx(balls)
    assert rates["bpfo"] == pytest.approx(balls * rates["ftf"])

    pump = body["auxiliary_pump"]
    assert pump["passes_per_shaft_turn"] == pytest.approx(pump["belt_ratio"] * pump["lobes"])


def _stream(body: dict) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    with client.stream("POST", "/agent/stream", json=body) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        name = ""
        for line in response.iter_lines():
            if line.startswith("event: "):
                name = line[len("event: ") :]
            elif line.startswith("data: "):
                events.append((name, json.loads(line[len("data: ") :])))
    return events


def test_a_run_is_streamed_step_by_step_and_ends_as_replay_does():
    pytest.importorskip("google.adk")
    body = {"fault": "rolling_element", "severity": 1.0, "seed": 1, "extra_noise": 0.45}
    events = _stream({**body, "plant": "t-stream", "remember": False})

    names = [name for name, _ in events]
    assert names[0] == "open" and names[-1] == "done"
    assert set(names[1:-1]) == {"step"}
    done = events[-1][1]
    assert events[0][1]["case_id"] == done["case"]["case_id"]

    # A step is sent when the call is made, with no answer yet, and again when the
    # tools answer. The last word on each step is what the finished run holds.
    first: dict[int, dict] = {}
    last: dict[int, dict] = {}
    for _, event in events[1:-1]:
        first.setdefault(event["index"], event["step"])
        last[event["index"]] = event["step"]
    assert [last[i] for i in range(len(done["steps"]))] == done["steps"]
    assert all(step["answered"] is None for step in first.values())
    assert any(step["answered"] for step in last.values())

    # Both agents worked the case, and the stream is the same run `/agent/replay` gives.
    assert {step["agent"] for step in done["steps"]} == {"investigator", "critic"}
    replay = client.post(
        "/agent/replay", json={**body, "plant": "t-stream-2", "remember": False}
    ).json()
    assert [(s["agent"], s["tool"]) for s in replay["steps"]] == [
        (s["agent"], s["tool"]) for s in done["steps"]
    ]
    assert replay["case"]["leader"] == done["case"]["leader"]
