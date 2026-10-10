"""Regression tests for the differentiator: asking for the right evidence.

A fault the physics can place is settled by simulation alone, and the agent
should *not* ask for a measurement it does not need. A case the physics cannot
place from a two-second capture (a moderate bearing fault or imbalance under
heavy noise) must end in a request, and the answer must settle it. A fault too
faint for anything on the menu must end unresolved, never as a guess.

The answers here are honest: a new capture of the same machine in the same
state, as long as the test asks for, never a clean or full-strength copy.

If these tests start failing, the product has quietly turned back into a
classifier, whatever the accuracy numbers say.
"""

from __future__ import annotations

import pytest

from hypothesis_engine.data.rig import BENCH_RIG, rig_oracle, synthetic_capture
from hypothesis_engine.investigation.engine import CONCLUDE_ABOVE, DISTINCT_SIGMA, Investigation
from hypothesis_engine.models import FaultKind

# Faults a two-second capture cannot place, but one requested measurement can:
# strong enough for a longer capture (or a coast-down) to show, noisy enough
# that the first look cannot.
UNPLACEABLE = {
    FaultKind.OUTER_RACE: {"severity": 0.5, "extra_noise": 0.45, "seed": 11},
    FaultKind.INNER_RACE: {"severity": 0.5, "extra_noise": 0.45, "seed": 555},
    FaultKind.IMBALANCE: {"severity": 0.5, "extra_noise": 0.6, "seed": 555},
}

# Too faint for the menu: a 30 s envelope capture reads within a sigma of what a
# healthy machine would give.
TOO_FAINT = {"severity": 0.35, "extra_noise": 0.45, "seed": 555}

# Harmonic patterns stay distinct under the same noise: a 0.35-amplitude tone
# over two seconds of data stands far above a noise floor of 0.45 rms.
PLACEABLE = [FaultKind.MISALIGNMENT, FaultKind.LOOSENESS]


def _case(fault: FaultKind, capture: dict) -> tuple[Investigation, object]:
    inv = Investigation(BENCH_RIG, synthetic_capture(fault, BENCH_RIG, **capture))
    answers = rig_oracle(
        fault, BENCH_RIG, severity=capture["severity"], extra_noise=capture["extra_noise"]
    )
    return inv, answers


@pytest.mark.parametrize("fault", list(UNPLACEABLE))
def test_an_unplaceable_fault_forces_a_measurement_request(fault: FaultKind):
    inv, _ = _case(fault, UNPLACEABLE[fault])
    inv.observe()
    inv.run_virtual_experiments()

    assert inv.state.leader().posterior < CONCLUDE_ABOVE, (
        "simulation alone should not settle this case"
    )
    choice = inv.choose_next_test()
    assert choice is not None
    assert choice.expected_info_gain > 0.05
    assert choice.settle_chance > 0.0
    # The chosen test must actually separate the two leading suspects.
    first, second = inv.state.ranked()[:2]
    assert choice.separates == (first.name, second.name)
    apart = abs(choice.predictions[first.name] - choice.predictions[second.name])
    assert apart >= DISTINCT_SIGMA * choice.sigma


@pytest.mark.parametrize("fault", list(UNPLACEABLE))
def test_requested_evidence_actually_settles_the_case(fault: FaultKind):
    inv, answers = _case(fault, UNPLACEABLE[fault])
    state = inv.run(oracle=answers)
    assert state.conclusion is not None, state.unresolved_reason
    assert state.conclusion.root_cause is fault
    assert state.outcomes, "the case should have been decided by a measurement, not a guess"


@pytest.mark.parametrize("fault", [FaultKind.OUTER_RACE, FaultKind.INNER_RACE])
def test_a_fault_too_faint_for_the_menu_ends_unresolved_not_guessed(fault: FaultKind):
    inv, answers = _case(fault, TOO_FAINT)
    state = inv.run(oracle=answers)
    assert state.conclusion is None, f"named {state.conclusion and state.conclusion.cause}"
    assert state.outcome == "unresolved"
    assert "a verdict needs 80%" in state.unresolved_reason


@pytest.mark.parametrize("fault", PLACEABLE)
def test_a_distinct_harmonic_pattern_needs_no_measurement_even_under_noise(fault: FaultKind):
    inv, answers = _case(fault, TOO_FAINT)
    state = inv.run(oracle=answers)
    assert state.conclusion is not None, state.unresolved_reason
    assert state.conclusion.root_cause is fault
    assert not state.requested_tests


def test_a_clean_strong_fault_needs_no_measurement():
    obs = synthetic_capture(FaultKind.OUTER_RACE, BENCH_RIG, severity=1.0)
    inv = Investigation(BENCH_RIG, obs)
    inv.observe()
    inv.run_virtual_experiments()
    assert inv.state.leader().posterior >= CONCLUDE_ABOVE
    assert inv.state.leader().kind is FaultKind.OUTER_RACE


def test_every_conclusion_says_what_would_change_it():
    for fault in (FaultKind.OUTER_RACE, FaultKind.IMBALANCE):
        inv, answers = _case(fault, UNPLACEABLE[fault])
        state = inv.run(oracle=answers)
        assert state.conclusion is not None
        assert len(state.conclusion.what_would_change_my_mind) > 20
