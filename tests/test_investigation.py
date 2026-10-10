"""The loop itself: does it reach the right answer, and does it ask good questions?"""

from __future__ import annotations

import pytest

from hypothesis_engine.data.rig import BENCH_RIG, rig_oracle, synthetic_capture
from hypothesis_engine.investigation.engine import Investigation
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


def test_it_asks_for_the_cheap_test_that_separates_the_suspects():
    # The two races are left standing; the envelope capture separates them in
    # three minutes, while a coast-down costs ten and a stop and separates nothing.
    obs = synthetic_capture(
        FaultKind.OUTER_RACE, BENCH_RIG, severity=0.35, extra_noise=0.45, seed=555
    )
    races = (FaultKind.OUTER_RACE, FaultKind.INNER_RACE)
    inv = Investigation(BENCH_RIG, obs, candidates=races)
    inv.observe()
    inv.run_virtual_experiments()
    assert all(h.posterior > 0.2 for h in inv.state.hypotheses), "both races still stand"
    choice = inv.choose_next_test()
    assert choice is not None
    assert choice.test.id == "envelope"
    assert choice.test.downtime == "none"
    assert choice.expected_info_gain > 0


def test_every_conclusion_cites_evidence():
    obs = synthetic_capture(FaultKind.IMBALANCE, BENCH_RIG)
    inv = Investigation(BENCH_RIG, obs)
    state = inv.run(oracle=rig_oracle(FaultKind.IMBALANCE, BENCH_RIG))
    assert state.conclusion is not None
    assert len(state.conclusion.evidence_ids) >= 5
    assert {e.id for e in state.ledger} >= set(state.conclusion.evidence_ids)
