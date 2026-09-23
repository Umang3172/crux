"""The loop itself: does it reach the right answer, and does it ask good questions?"""

from __future__ import annotations

import pytest

from hypothesis_engine.data.rig import BENCH_RIG, rig_oracle, synthetic_capture
from hypothesis_engine.investigation.engine import Investigation, verify_repair
from hypothesis_engine.models import FaultKind

FAULTS = [
    FaultKind.IMBALANCE,
    FaultKind.MISALIGNMENT,
    FaultKind.LOOSENESS,
    FaultKind.OUTER_RACE,
    FaultKind.INNER_RACE,
]


@pytest.mark.parametrize("fault", FAULTS)
def test_investigation_finds_the_induced_fault(fault: FaultKind):
    obs = synthetic_capture(fault, BENCH_RIG)
    inv = Investigation(BENCH_RIG, obs)
    state = inv.run(oracle=rig_oracle(fault, BENCH_RIG))
    assert state.conclusion is not None
    assert state.conclusion.root_cause is fault, (
        f"expected {fault.value}, got {state.conclusion.root_cause.value}; "
        f"beliefs: { {k.value: round(v, 3) for k, v in state.belief().items()} }"
    )


def test_virtual_experiments_reject_at_least_one_rival():
    obs = synthetic_capture(FaultKind.OUTER_RACE, BENCH_RIG)
    inv = Investigation(BENCH_RIG, obs)
    inv.observe()
    inv.run_virtual_experiments()
    assert any(h.rejected for h in inv.state.hypotheses)


def test_it_asks_for_a_cheap_test_before_an_expensive_one():
    obs = synthetic_capture(FaultKind.LOOSENESS, BENCH_RIG)
    inv = Investigation(BENCH_RIG, obs)
    inv.observe()
    inv.run_virtual_experiments()
    choice = inv.choose_next_test()
    assert choice is not None
    assert choice.test.downtime == "none", "a test needing downtime should never win on gain/minute"
    assert choice.expected_info_gain > 0


def test_every_conclusion_cites_evidence():
    obs = synthetic_capture(FaultKind.IMBALANCE, BENCH_RIG)
    inv = Investigation(BENCH_RIG, obs)
    state = inv.run(oracle=rig_oracle(FaultKind.IMBALANCE, BENCH_RIG))
    assert state.conclusion is not None
    assert len(state.conclusion.evidence_ids) >= 5
    assert {e.id for e in state.ledger} >= set(state.conclusion.evidence_ids)


def test_repair_verification_compares_against_the_prediction():
    before = synthetic_capture(FaultKind.IMBALANCE, BENCH_RIG)
    after = synthetic_capture(FaultKind.HEALTHY, BENCH_RIG, seed=999)
    result = verify_repair(before, after, BENCH_RIG, FaultKind.IMBALANCE)
    assert result["verified"] is True
    assert result["actual_reduction"] > 0
