"""Regression tests for the differentiator: asking for the right evidence.

A clean, strong fault is settled by simulation alone — and the agent should
*not* ask for a measurement it does not need. A mild fault under noise is
ambiguous, and then the agent must ask, and the answer must settle it.

If these tests start failing, the product has quietly turned back into a
classifier, whatever the accuracy numbers say.
"""

from __future__ import annotations

import pytest

from hypothesis_engine.data.rig import BENCH_RIG, rig_oracle, synthetic_capture
from hypothesis_engine.investigation.engine import CONCLUDE_ABOVE, Investigation
from hypothesis_engine.models import FaultKind

AMBIGUOUS = {"severity": 0.35, "extra_noise": 0.45, "seed": 555}


@pytest.mark.parametrize(
    "fault", [FaultKind.IMBALANCE, FaultKind.MISALIGNMENT, FaultKind.LOOSENESS]
)
def test_mild_noisy_faults_force_a_measurement_request(fault: FaultKind):
    obs = synthetic_capture(fault, BENCH_RIG, **AMBIGUOUS)
    inv = Investigation(BENCH_RIG, obs)
    inv.observe()
    inv.run_virtual_experiments()

    assert inv.state.leader().posterior < CONCLUDE_ABOVE, (
        "simulation alone should not settle a mild fault under noise"
    )
    choice = inv.choose_next_test()
    assert choice is not None
    assert choice.expected_info_gain > 0.05
    assert choice.test.downtime == "none"


@pytest.mark.parametrize(
    "fault", [FaultKind.IMBALANCE, FaultKind.MISALIGNMENT, FaultKind.LOOSENESS]
)
def test_requested_evidence_actually_settles_the_case(fault: FaultKind):
    obs = synthetic_capture(fault, BENCH_RIG, **AMBIGUOUS)
    inv = Investigation(BENCH_RIG, obs)
    state = inv.run(oracle=rig_oracle(fault, BENCH_RIG))
    assert state.conclusion is not None
    assert state.conclusion.root_cause is fault
    assert state.outcomes, "the case should have been decided by a measurement, not a guess"


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
