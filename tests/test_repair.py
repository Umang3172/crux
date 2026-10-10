"""Was the repair a repair?

The capture after a repair is investigated as a case of its own, so the answer
is the engine's verdict on the machine as it now runs, not a typed expectation
of how much a repair should help. The captures here come from the rig, at seeds
the engine's own simulations never use; the last tests use a rig built tone by
tone in `test_own_normal`, whose normal is not the textbook's.
"""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient
from typer.testing import CliRunner

from hypothesis_engine.api import app as api
from hypothesis_engine.cli import app as cli
from hypothesis_engine.data.rig import BENCH_RIG, BENCH_RIG_ESP32, rig_oracle, synthetic_capture
from hypothesis_engine.data.stream import Streams
from hypothesis_engine.investigation.engine import ACTIONS, CONCLUDE_ABOVE, Investigation
from hypothesis_engine.investigation.repair import ONE_CAPTURE, NothingToVerify, check_repair
from hypothesis_engine.models import FaultKind, Observation
from hypothesis_engine.physics.frequencies import fault_frequencies, shaft_hz
from hypothesis_engine.physics.signatures import OrderSuspect
from test_ingest import FS as LIVE_FS  # tests/ is on the path, not a package
from test_ingest import RIG as LIVE_RIG
from test_ingest import TOKEN, _batches
from test_own_normal import investigate as investigate_quirky_rig
from test_own_normal import rig_capture

client = TestClient(api.app)

FAULTS = [
    FaultKind.OUTER_RACE,
    FaultKind.INNER_RACE,
    FaultKind.IMBALANCE,
    FaultKind.MISALIGNMENT,
    FaultKind.LOOSENESS,
]


def _closed(fault: FaultKind | str, severity: float = 1.0, noise: float = 0.05) -> Investigation:
    """A case on the rig, run to its end."""
    capture = synthetic_capture(fault, BENCH_RIG, severity=severity, extra_noise=noise)
    inv = Investigation(BENCH_RIG, capture)
    inv.run(oracle=rig_oracle(fault, BENCH_RIG, severity=severity, extra_noise=noise))
    return inv


def _after(fault: FaultKind | str, severity: float = 1.0, noise: float = 0.05) -> Observation:
    """The rig captured again after a repair, in whatever state the repair left it."""
    return synthetic_capture(fault, BENCH_RIG, severity=severity, seed=4242, extra_noise=noise)


@pytest.fixture(scope="module")
def outer() -> Investigation:
    inv = _closed(FaultKind.OUTER_RACE)
    assert inv.state.conclusion is not None and inv.state.conclusion.cause == "outer_race"
    return inv


# ------------------------------------------------------------------ the four answers


@pytest.mark.parametrize("fault", FAULTS)
def test_a_machine_that_runs_normally_after_the_repair_is_verified(fault):
    case = _closed(fault)
    assert case.state.conclusion.root_cause is fault, "the premise: the fault was found"

    check = check_repair(case, _after(FaultKind.HEALTHY))

    assert check.outcome == "verified" and check.found == "healthy"
    assert check.belief >= CONCLUDE_ABOVE
    assert check.statement.startswith("Verified")
    fell = check.lines[0]
    assert fell.after < fell.before, "what the fault raised has come down"
    assert fell.line in check.statement


@pytest.mark.parametrize("fault", FAULTS)
def test_half_a_repair_is_not_verified_and_the_line_still_standing_is_named(fault):
    case = _closed(fault)

    check = check_repair(case, _after(fault, severity=0.5))

    assert check.outcome == "still_there" and check.found == fault.value
    assert check.statement.startswith("Not verified")
    (named,) = [c for c in check.lines if f"the one at {c.line} still stands" in check.statement]
    assert named.after > 2 * named.usual, "it stands well above what a healthy machine shows"
    assert check.limit == ""


def test_the_line_named_is_the_faults_own_not_one_every_machine_has(outer):
    # An outer-race fault and a healthy machine both have a tall 1x. The line
    # that says the bearing is still damaged is the one at the race's rate.
    check = check_repair(outer, _after(FaultKind.OUTER_RACE, severity=0.5))
    rate = fault_frequencies(BENCH_RIG.bearing, outer.rpm).as_dict()["bpfo"] / shaft_hz(outer.rpm)

    assert f"the one at {rate:.3g}x in the envelope still stands" in check.statement
    tallest = max(check.lines, key=lambda c: c.after)
    assert tallest.line == "1x in the spectrum", "the premise: the tallest line is not the tell"


def test_a_repair_that_leaves_another_fault_says_which(outer):
    check = check_repair(outer, _after(FaultKind.MISALIGNMENT, severity=0.75))

    assert check.outcome == "something_else" and check.found == "misalignment"
    assert check.statement.startswith("Outer race no longer explains the capture")
    assert ACTIONS[FaultKind.MISALIGNMENT] in check.statement


def test_a_cause_that_is_gone_is_said_to_be_gone_even_with_no_verdict_on_the_rest(outer):
    # The bearing was replaced and something else now strikes 7.6 times a turn,
    # which nothing on the list predicts. No verdict, but the outer race is out.
    check = check_repair(outer, _after("unlisted_impact"))

    assert check.outcome == "cause_gone" and check.found is None
    assert check.statement.startswith("The fault that was repaired no longer shows: outer race")
    assert "no hypothesis on the list predicts" in check.statement
    gone = next(h for h in check.follow.state.hypotheses if h.name == "outer_race")
    assert gone.rejected


def test_one_capture_that_cannot_tell_says_so_and_why():
    # A quarter of an imbalance left: more 1x than a healthy machine, not enough
    # for one two-second capture to call it either way.
    case = _closed(FaultKind.IMBALANCE)

    check = check_repair(case, _after(FaultKind.IMBALANCE, severity=0.25))

    assert check.outcome == "cannot_tell" and check.found is None and check.belief is None
    assert check.statement.startswith("Not verified either way. Imbalance itself stands at")
    assert "a verdict needs 80%" in check.statement and ONE_CAPTURE in check.statement


def test_a_verified_repair_says_what_one_capture_could_not_have_seen(outer):
    # On this rig a mild imbalance hides in a healthy capture. After a balancing
    # job that is the repaired cause itself, and the check says so.
    balanced = check_repair(_closed(FaultKind.IMBALANCE), _after(FaultKind.HEALTHY))
    rebuilt = check_repair(outer, _after(FaultKind.HEALTHY))

    assert balanced.outcome == rebuilt.outcome == "verified"
    assert "imbalance at severity 0.25 cannot be excluded" in balanced.limit
    assert balanced.limit_names_cause
    assert not rebuilt.limit_names_cause, "a bearing fault that mild would have shown"


def test_no_fault_named_means_no_repair_to_check():
    healthy = _closed(FaultKind.HEALTHY)
    unresolved = _closed("rolling_element", severity=0.25, noise=0.6)
    assert unresolved.state.outcome == "unresolved"

    with pytest.raises(NothingToVerify, match="nothing is wrong"):
        check_repair(healthy, _after(FaultKind.HEALTHY))
    with pytest.raises(NothingToVerify, match="no verdict"):
        check_repair(unresolved, _after(FaultKind.HEALTHY))


def test_the_second_case_starts_from_even_odds_and_leaves_the_first_alone(outer):
    before = (dict(outer.state.beliefs()), len(outer.ledger.items), outer.state.conclusion)

    check = check_repair(outer, _after(FaultKind.OUTER_RACE, severity=0.5))

    priors = {round(h.prior, 9) for h in check.follow.state.hypotheses}
    assert len(priors) == 1, "the first verdict is not a prior for the second"
    assert check.follow.state.id != outer.state.id
    assert before == (dict(outer.state.beliefs()), len(outer.ledger.items), outer.state.conclusion)


def test_a_cause_written_during_the_case_can_be_found_still_there():
    # A damaged rolling element is not on the list: it was written as a suspect.
    # After half a repair that suspect has to be on the list again.
    capture = synthetic_capture("rolling_element", BENCH_RIG)
    case = Investigation(BENCH_RIG, capture)
    case.observe()
    case.run_virtual_experiments()
    orders = fault_frequencies(BENCH_RIG.bearing, case.rpm).as_dict()
    fr = shaft_hz(case.rpm)
    ball = OrderSuspect(
        "ball", "A damaged ball.", impacts=((orders["2xbsf"] / fr, 4.0, orders["ftf"] / fr, None),)
    )
    assert case.add_hypothesis(ball)[0]
    assert case.conclude().cause == "ball"

    half = check_repair(case, _after("rolling_element", severity=0.5))
    done = check_repair(case, _after(FaultKind.HEALTHY))

    assert (half.outcome, half.found) == ("still_there", "ball")
    assert done.outcome == "verified"


# ------------------------------------------------------------------ a machine with its own normal


def test_a_repair_is_checked_against_the_machines_own_normal():
    # This rig's healthy captures read as misaligned to the textbook machine.
    # Checked against them, the repaired rig is verified.
    case, state = investigate_quirky_rig(FaultKind.OUTER_RACE)
    assert state.conclusion is not None and state.conclusion.cause == "outer_race"
    repaired = rig_capture(FaultKind.HEALTHY, seed=77)
    textbook = Investigation(BENCH_RIG, repaired)
    textbook.observe()
    textbook.run_virtual_experiments()
    assert textbook.state.leader().kind is FaultKind.MISALIGNMENT, "the premise"

    check = check_repair(case, repaired)

    assert check.outcome == "verified"
    assert check.usual_from == "healthy captures"
    assert check.follow.state.extra["own_normal"]["captures"] == len(case.normal)
    assert "this machine's healthy captures show" in check.statement


def test_half_a_repair_on_that_machine_is_not_verified():
    case, _ = investigate_quirky_rig(FaultKind.OUTER_RACE)

    check = check_repair(case, rig_capture(FaultKind.OUTER_RACE, severity=0.5, seed=77))

    assert check.outcome == "still_there" and check.found == "outer_race"


# ------------------------------------------------------------------ the API and the CLI


def test_the_rig_can_be_repaired_well_half_way_or_badly_through_the_api():
    case = client.post("/replay", json={"fault": "outer_race", "seed": 1234}).json()
    path = f"/investigations/{case['id']}/repair"

    well = client.post(path, json={"removed": 1.0}).json()
    half = client.post(path, json={"removed": 0.5}).json()
    badly = client.post(path, json={"left_behind": "misalignment"}).json()

    assert (well["outcome"], well["found"]) == ("verified", "healthy")
    assert (half["outcome"], half["found"]) == ("still_there", "outer_race")
    assert half["rig"] == {"fault": "outer_race", "severity": 0.5}
    assert (badly["outcome"], badly["found"]) == ("something_else", "misalignment")
    assert well["lines"][0]["after"] < well["lines"][0]["before"]
    assert well["usual_from"] == "simulation"
    # The capture after the repair is a case like any other.
    after = client.get(f"/investigations/{well['after']['id']}").json()
    assert after["conclusion"]["root_cause"] == "healthy"
    assert client.get(f"/investigations/{well['after']['id']}/report").status_code == 200
    # The first case is as it was.
    assert client.get(f"/investigations/{case['id']}").json()["conclusion"] == case["conclusion"]


def test_the_repair_route_refuses_what_makes_no_sense():
    healthy = client.post("/replay", json={"fault": "healthy", "seed": 1234}).json()
    faulty = client.post("/replay", json={"fault": "looseness", "seed": 1234}).json()

    nothing = client.post(f"/investigations/{healthy['id']}/repair", json={})
    both = client.post(
        f"/investigations/{faulty['id']}/repair",
        json={"removed": 0.5, "left_behind": "misalignment"},
    )

    assert nothing.status_code == 409 and "nothing is wrong" in nothing.json()["detail"]
    assert both.status_code == 422
    assert client.post("/investigations/no-such-case/repair", json={}).status_code == 404


def test_a_live_machine_is_checked_on_its_latest_signal(monkeypatch):
    monkeypatch.setenv("RIG_INGEST_TOKEN", TOKEN)
    monkeypatch.setattr(api, "_LIVE", Streams({LIVE_RIG: BENCH_RIG_ESP32}))
    live = TestClient(api.app)

    def post(fault: FaultKind, start_ms: float, seed: int) -> None:
        x = synthetic_capture(fault, BENCH_RIG_ESP32, duration_s=8.0, seed=seed).waveform
        for batch in _batches(x, start_ms):
            assert live.post("/ingest", json=batch).status_code == 200

    who = {"token": TOKEN}
    post(FaultKind.HEALTHY, 0.0, seed=3)
    assert live.post(f"/ingest/{LIVE_RIG}/normal", json=who).status_code == 200
    post(FaultKind.IMBALANCE, 60_000.0, seed=4)
    case = live.post(f"/ingest/{LIVE_RIG}/investigate", json=who).json()
    assert case["outcome"] == "concluded", case["unresolved_reason"]
    assert case["conclusion"]["root_cause"] == "imbalance"

    post(FaultKind.HEALTHY, 120_000.0, seed=5)
    check = live.post(f"/ingest/{LIVE_RIG}/repair/{case['id']}", json=who)

    assert check.status_code == 200, check.text
    # This sensor cannot see where bearing damage shows, so it never concludes
    # "healthy". It can see that the imbalance has gone, and says that much.
    assert check.json()["outcome"] == "cause_gone", check.json()["statement"]
    assert "imbalance stands at" in check.json()["statement"]
    assert check.json()["usual_from"] == "healthy captures"
    assert check.json()["rig"] is None
    assert live.post(f"/ingest/{LIVE_RIG}/repair/{case['id']}", json={}).status_code == 401
    assert np.isclose(LIVE_FS, BENCH_RIG_ESP32.sample_rate_hz)


def test_the_demo_command_checks_its_repair():
    shown = CliRunner().invoke(cli, ["demo", "--fault", "looseness"])

    assert shown.exit_code == 0, shown.output
    assert "After the repair" in shown.output and "Verified" in shown.output
