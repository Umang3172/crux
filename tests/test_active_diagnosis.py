"""Regression tests for the differentiator: asking for the right evidence.

A fault the physics can place is settled by simulation alone, and the agent
should *not* ask for a measurement it does not need. A case the physics
genuinely cannot place — a mild bearing fault under heavy noise, or a mild
imbalance that looks like a healthy machine without a baseline — must end in a
request, and the answer must settle it.

If these tests start failing, the product has quietly turned back into a
classifier, whatever the accuracy numbers say.
"""

from __future__ import annotations

import pytest

from hypothesis_engine.data.rig import BENCH_RIG, rig_oracle, synthetic_capture
from hypothesis_engine.investigation.engine import CONCLUDE_ABOVE, Investigation
from hypothesis_engine.models import FaultKind

AMBIGUOUS = {"severity": 0.35, "extra_noise": 0.45, "seed": 555}

# Which mild, noisy faults the physics cannot place without a measurement, and
# why: the two races differ only in where weak impacts line up; a mild imbalance
# differs from a healthy machine only in how tall 1x is.
UNPLACEABLE = [FaultKind.IMBALANCE, FaultKind.OUTER_RACE, FaultKind.INNER_RACE]

# Harmonic patterns stay distinct under the same noise: a 0.35-amplitude tone
# over two seconds of data stands far above a noise floor of 0.45 rms.
PLACEABLE = [FaultKind.MISALIGNMENT, FaultKind.LOOSENESS]


@pytest.mark.parametrize("fault", UNPLACEABLE)
def test_an_unplaceable_fault_forces_a_measurement_request(fault: FaultKind):
    obs = synthetic_capture(fault, BENCH_RIG, **AMBIGUOUS)
    inv = Investigation(BENCH_RIG, obs)
    inv.observe()
    inv.run_virtual_experiments()

    assert inv.state.leader().posterior < CONCLUDE_ABOVE, (
        "simulation alone should not settle this case"
    )
    choice = inv.choose_next_test()
    assert choice is not None
    assert choice.expected_info_gain > 0.05
    # The chosen test must actually separate the two leading suspects.
    first, second = inv.state.ranked()[:2]
    a, b = choice.test.predict(first.kind), choice.test.predict(second.kind)
    assert abs(a - b) >= choice.test.sigma


@pytest.mark.parametrize("fault", UNPLACEABLE)
def test_requested_evidence_actually_settles_the_case(fault: FaultKind):
    obs = synthetic_capture(fault, BENCH_RIG, **AMBIGUOUS)
    inv = Investigation(BENCH_RIG, obs)
    state = inv.run(oracle=rig_oracle(fault, BENCH_RIG))
    assert state.conclusion is not None, state.unresolved_reason
    assert state.conclusion.root_cause is fault
    assert state.outcomes, "the case should have been decided by a measurement, not a guess"


@pytest.mark.parametrize("fault", PLACEABLE)
def test_a_distinct_harmonic_pattern_needs_no_measurement_even_under_noise(fault: FaultKind):
    obs = synthetic_capture(fault, BENCH_RIG, **AMBIGUOUS)
    inv = Investigation(BENCH_RIG, obs)
    state = inv.run(oracle=rig_oracle(fault, BENCH_RIG))
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
        obs = synthetic_capture(fault, BENCH_RIG, **AMBIGUOUS)
        inv = Investigation(BENCH_RIG, obs)
        state = inv.run(oracle=rig_oracle(fault, BENCH_RIG))
        assert state.conclusion is not None
        assert len(state.conclusion.what_would_change_my_mind) > 20
