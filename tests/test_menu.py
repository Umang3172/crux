"""Why this measurement and not the others.

When the engine asks for a measurement it has weighed every one on the menu.
The whole weighing is kept with the request: each measurement's expected
information, its cost, its chance of settling the case, and why it won or lost.
Every figure is the one the choice was made on.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from hypothesis_engine.api.app import app
from hypothesis_engine.data.rig import BENCH_RIG, rig_oracle, synthetic_capture
from hypothesis_engine.investigation.catalog import BY_ID, CATALOG
from hypothesis_engine.investigation.engine import CONCLUDE_ABOVE, DISTINCT_SIGMA, Investigation
from hypothesis_engine.models import FaultKind

client = TestClient(app)

# An inner-race fault the first look cannot place, and a fainter one.
AMBIGUOUS = {"severity": 0.5, "extra_noise": 0.45, "seed": 555}
FAINT = {"severity": 0.35, "extra_noise": 0.45, "seed": 555}


def _opened(**capture) -> Investigation:
    inv = Investigation(BENCH_RIG, synthetic_capture(FaultKind.INNER_RACE, BENCH_RIG, **capture))
    inv.observe()
    inv.run_virtual_experiments()
    return inv


def test_the_request_carries_every_measurement_that_was_weighed():
    inv = _opened(**AMBIGUOUS)
    choice = inv.choose_next_test()
    inv.request(choice)
    rows = inv.state.extra["request"]["considered"]
    by_id = {row["test_id"]: row for row in rows}

    assert [row["test_id"] for row in rows] == [t.id for t in CATALOG], "the whole menu, in order"
    (chosen,) = [row for row in rows if row["fate"] == "chosen"]
    assert chosen["test_id"] == choice.test.id == inv.state.requested_tests[-1]
    # The row is the choice itself, not a figure written for the screen.
    assert chosen["gain"] == pytest.approx(choice.expected_info_gain, abs=1e-4)
    assert chosen["gain_per_minute"] == pytest.approx(choice.gain_per_minute, abs=1e-4)
    assert chosen["settle_chance"] == pytest.approx(choice.settle_chance, abs=1e-3)
    assert chosen["minutes"] == BY_ID[choice.test.id].effort_min
    assert set(by_id) == set(BY_ID)


def test_each_loser_lost_for_the_reason_its_row_gives():
    inv = _opened(**AMBIGUOUS)
    inv.request(inv.choose_next_test())
    rows = inv.state.extra["request"]["considered"]
    chosen = next(row for row in rows if row["fate"] == "chosen")
    fates = {row["fate"] for row in rows}
    assert {"chosen", "less_per_minute", "cannot_settle"} <= fates, "the premise: three kinds"

    for row in rows:
        if row["fate"] == "less_per_minute":
            assert row["settle_chance"] > 0 and row["apart_sigma"] >= DISTINCT_SIGMA
            assert row["gain_per_minute"] <= chosen["gain_per_minute"]
            assert f"{row['gain_per_minute']:.3f} nats a minute" in row["why"]
        elif row["fate"] == "cannot_settle":
            assert row["settle_chance"] == 0
            assert f"{CONCLUDE_ABOVE:.0%}" in row["why"]
        elif row["fate"] == "leaders_too_close":
            assert row["apart_sigma"] < DISTINCT_SIGMA
    # Worth seeing on a screen: the one chosen is not the likeliest to settle the
    # case. It is the most information for a technician's minute.
    longer = next(row for row in rows if row["fate"] == "less_per_minute")
    assert longer["settle_chance"] > chosen["settle_chance"]
    assert longer["minutes"] > chosen["minutes"]


def test_a_measurement_already_taken_is_marked_and_not_weighed_again():
    inv = _opened(**AMBIGUOUS)
    first = inv.choose_next_test()
    inv.request(first)
    answers = rig_oracle(
        FaultKind.INNER_RACE,
        BENCH_RIG,
        severity=AMBIGUOUS["severity"],
        extra_noise=AMBIGUOUS["extra_noise"],
    )
    inv.apply_outcome(first.test.id, answers(first.test.id))

    inv.choose_next_test()
    taken = next(row for row in inv.menu if row.test_id == first.test.id)

    assert taken.fate == "already_taken" and taken.gain is None
    assert taken.why == "Already asked for in this case."


def test_when_nothing_is_asked_for_the_menu_says_why_for_each():
    # Fainter still, and with the one useful reading already refused: nothing
    # left on the menu can settle it, and the case closes saying so.
    inv = _opened(**FAINT)
    choice = inv.advance()
    assert choice is not None, "the premise: one reading is worth asking for"
    inv.could_not_take(choice.test.id)

    assert inv.advance() is None
    left = inv.state.extra["no_test"]

    assert inv.state.outcome == "unresolved"
    assert left["reason"] in inv.state.unresolved_reason
    assert "chosen" not in {row["fate"] for row in left["considered"]}
    assert {row["fate"] for row in left["considered"]} <= {
        "already_taken",
        "cannot_settle",
        "leaders_too_close",
        "no_prediction",
    }
    assert all(row["why"] for row in left["considered"])


def test_the_api_hands_the_menu_to_the_screen():
    case = client.post("/investigations", json={"fault": "inner_race", **AMBIGUOUS}).json()

    rows = case["request"]["considered"]

    assert len(rows) == len(CATALOG) and case["no_test"] is None
    assert [row["test_id"] for row in rows if row["fate"] == "chosen"] == [
        case["request"]["test_id"]
    ]
