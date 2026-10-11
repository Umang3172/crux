"""What earlier cases on a machine came to.

A closed case leaves a record written by the engine. The next case on that
machine is shown it. It is knowledge, never evidence: these tests check both
that it arrives and that it moves nothing.
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from hypothesis_engine.api.app import app
from hypothesis_engine.data.rig import BENCH_RIG, rig_oracle, synthetic_capture
from hypothesis_engine.investigation.engine import Investigation
from hypothesis_engine.investigation.history import (
    SHOWN,
    CaseRecord,
    History,
    machine_key,
    record_of,
)
from hypothesis_engine.models import FaultKind
from hypothesis_engine.tools import InMemoryCaseStore, InvestigatorTools, open_case

client = TestClient(app)

# An inner-race fault the first look cannot place: the case opens and waits.
AMBIGUOUS = {"fault": "inner_race", "severity": 0.5, "extra_noise": 0.45, "seed": 555}


def _plant() -> str:
    """A plant of its own, so a test sees only the cases it made."""
    return f"t-{uuid.uuid4().hex[:10]}"


def _closed(fault: FaultKind | str, **how) -> Investigation:
    inv = Investigation(BENCH_RIG, synthetic_capture(fault, BENCH_RIG, **how))
    inv.run(oracle=rig_oracle(fault, BENCH_RIG))
    return inv


# ------------------------------------------------------------------ the record


def test_a_verdict_is_recorded_with_what_settled_it():
    record = record_of(_closed(FaultKind.OUTER_RACE), "plant-a/rig-01")

    assert (record.outcome, record.cause, record.cause_label) == (
        "concluded",
        "outer_race",
        "outer race",
    )
    assert record.settled_by == () and record.repair == ""
    assert record.sentence() == "Outer race at >99% belief, from the first capture alone."


def test_a_case_with_no_verdict_is_recorded_with_the_engines_reason():
    inv = _closed("rolling_element", severity=0.25, extra_noise=0.6)
    assert inv.state.outcome == "unresolved"

    record = record_of(inv, "plant-a/rig-01")

    assert record.outcome == "unresolved" and record.cause is None and record.belief is None
    assert record.reason == inv.state.unresolved_reason
    assert record.sentence().startswith("No cause was named. ")


def test_the_sentence_says_which_readings_it_took_and_what_the_repair_check_found():
    record = CaseRecord(
        case_id="inv_1",
        machine="plant-a/rig-01",
        closed_at="2026-10-11T08:00:00+00:00",
        outcome="concluded",
        cause="inner_race",
        cause_label="inner race",
        belief=0.94,
        settled_by=("Envelope capture around the bearing resonance",),
        repair="still_there",
    )

    assert record.sentence() == (
        "Inner race at 94% belief, after 1 more reading (Envelope capture around the bearing "
        "resonance); the check after the repair found the fault still there."
    )


def test_an_open_case_has_nothing_to_remember():
    inv = Investigation(BENCH_RIG, synthetic_capture(FaultKind.OUTER_RACE, BENCH_RIG))
    inv.observe()
    try:
        record_of(inv, "plant-a/rig-01")
    except ValueError as exc:
        assert "still open" in str(exc)
    else:
        raise AssertionError("an open case was recorded")


# ------------------------------------------------------------------ the store


def test_the_store_gives_a_machines_latest_cases_newest_first_and_only_its_own(tmp_path):
    history = History()
    for k in range(SHOWN + 2):
        history.add(
            CaseRecord(
                f"inv_{k}", "plant-a/rig-01", f"2026-10-0{k + 1}T08:00:00+00:00", "unresolved"
            )
        )
    history.add(CaseRecord("inv_x", "plant-b/rig-01", "2026-10-09T08:00:00+00:00", "unresolved"))

    shown = history.earlier("plant-a/rig-01")

    assert [r.case_id for r in shown] == [f"inv_{k}" for k in range(SHOWN + 1, 1, -1)]
    assert [r.case_id for r in history.earlier("plant-b/rig-01")] == ["inv_x"]
    assert history.earlier("plant-c/rig-01") == []


def test_a_record_on_file_survives_a_restart_with_what_the_repair_check_found(tmp_path):
    path = tmp_path / "site" / "history.jsonl"
    first = History(path)
    first.add(record_of(_closed(FaultKind.OUTER_RACE), "plant-a/rig-01"))
    (kept,) = first.earlier("plant-a/rig-01")
    first.note_repair(kept.case_id, "verified")

    (again,) = History(path).earlier("plant-a/rig-01")

    assert again == first.get(kept.case_id)
    assert again.repair == "verified" and again.sentence().endswith("the repair was verified.")
    assert first.note_repair("no-such-case", "verified") is None


# ------------------------------------------------------------------ it moves nothing


def test_what_is_on_file_changes_no_belief_in_the_next_case():
    capture = synthetic_capture(FaultKind.INNER_RACE, BENCH_RIG, severity=0.5, extra_noise=0.45)
    answers = rig_oracle(FaultKind.INNER_RACE, BENCH_RIG, severity=0.5, extra_noise=0.45)
    plain = Investigation(BENCH_RIG, capture)
    told = Investigation(BENCH_RIG, capture)
    # Five earlier verdicts on this machine, all outer race, all at 99%.
    told.state.extra["history"] = [
        CaseRecord(
            f"inv_{k}",
            "p/rig-01",
            "2026-10-01T08:00:00+00:00",
            "concluded",
            "outer_race",
            "outer race",
            0.99,
        ).to_dict()
        for k in range(5)
    ]

    a, b = plain.run(oracle=answers), told.run(oracle=answers)

    assert a.beliefs() == b.beliefs(), "an earlier verdict is not a prior"
    assert a.outcome == b.outcome and a.requested_tests == b.requested_tests
    assert [e.render() for e in a.ledger] == [e.render() for e in b.ledger]


def test_a_model_can_ask_what_is_on_file_and_has_no_tool_that_writes_it():
    store = InMemoryCaseStore()
    case = open_case(store, BENCH_RIG, synthetic_capture(FaultKind.OUTER_RACE, BENCH_RIG))
    tools = InvestigatorTools(store)
    assert tools.recall_cases(case.id).cases == []
    assert tools.recall_cases(case.id).detail == "No earlier case is on file for this machine."

    earlier = record_of(_closed(FaultKind.IMBALANCE), machine_key("p", BENCH_RIG.machine_id))
    case.investigation.state.extra["history"] = [earlier.to_dict()]
    found = tools.recall_cases(case.id)

    assert [(c.cause, c.outcome) for c in found.cases] == [("imbalance", "concluded")]
    assert found.cases[0].sentence == earlier.sentence()
    assert found.detail == "1 earlier case on file for this machine."
    names = {fn.__name__ for fn in tools.agent_functions()}
    assert "recall_cases" in names
    assert not {n for n in names if "remember" in n or "record" in n}


# ------------------------------------------------------------------ through the API


def test_the_next_case_on_a_machine_is_shown_the_one_before():
    plant = _plant()
    first = client.post("/replay", json={"fault": "outer_race", "plant": plant}).json()
    assert first["history"] == [], "nothing was on file when the first case opened"

    second = client.post("/replay", json={"fault": "healthy", "plant": plant}).json()

    (record,) = second["history"]
    assert record["case_id"] == first["id"] and record["cause"] == "outer_race"
    assert record["sentence"] == "Outer race at >99% belief, from the first capture alone."
    # The same healthy capture in a plant with nothing on file is believed the same.
    fresh = client.post("/replay", json={"fault": "healthy", "plant": _plant()}).json()
    assert fresh["hypotheses"] == second["hypotheses"]
    assert fresh["conclusion"]["confidence"] == second["conclusion"]["confidence"]


def test_one_plant_does_not_see_another_plants_machine():
    here, there = _plant(), _plant()
    client.post("/replay", json={"fault": "outer_race", "plant": here})

    assert client.post("/replay", json={"fault": "healthy", "plant": there}).json()["history"] == []


def test_a_case_asked_not_to_be_kept_is_not():
    plant = _plant()
    client.post("/replay", json={"fault": "outer_race", "plant": plant, "remember": False})

    assert client.post("/replay", json={"fault": "healthy", "plant": plant}).json()["history"] == []


def test_a_case_is_kept_when_it_closes_not_when_it_opens():
    plant = _plant()
    settled = client.post("/replay", json={**AMBIGUOUS, "plant": plant, "remember": False}).json()
    waiting = client.post("/investigations", json={**AMBIGUOUS, "plant": plant}).json()
    assert waiting["outcome"] == "open"
    assert (
        client.post("/replay", json={"fault": "healthy", "plant": plant, "remember": False}).json()[
            "history"
        ]
        == []
    ), "an open case is not on file"

    state = waiting
    for reading in settled["outcomes"]:
        if state["outcome"] != "open":
            break
        state = client.post(
            f"/investigations/{waiting['id']}/evidence",
            json={"test_id": reading["test_id"], "value": reading["value"]},
        ).json()
    assert state["outcome"] != "open", "the premise: its readings close the case"

    (record,) = client.post("/replay", json={"fault": "healthy", "plant": plant}).json()["history"]
    assert record["case_id"] == waiting["id"]
    assert len(record["settled_by"]) == len(state["outcomes"]) >= 1


def test_the_record_learns_what_the_check_after_the_repair_found():
    plant = _plant()
    case = client.post("/replay", json={"fault": "outer_race", "plant": plant}).json()

    client.post(f"/investigations/{case['id']}/repair", json={"removed": 0.5})
    (half,) = client.post(
        "/replay", json={"fault": "healthy", "plant": plant, "remember": False}
    ).json()["history"]
    client.post(f"/investigations/{case['id']}/repair", json={"removed": 1.0})
    history = client.post("/replay", json={"fault": "healthy", "plant": plant}).json()["history"]

    assert half["repair"] == "still_there"
    assert half["sentence"].endswith("the check after the repair found the fault still there.")
    assert [r["case_id"] for r in history] == [case["id"]], "the follow-up is not a case of its own"
    assert history[0]["repair"] == "verified", "the latest check is the one on file"
