"""The rules the engine keeps whatever the scoring: one belief distribution, no
verdict below the bar, nothing unexplained left behind a verdict, and words that
match the ledger."""

from __future__ import annotations

import numpy as np
import pytest

from hypothesis_engine.data.rig import BENCH_RIG, synthetic_capture
from hypothesis_engine.investigation import engine as eng
from hypothesis_engine.investigation.engine import (
    CONCLUDE_ABOVE,
    REJECT_BELOW,
    CannotConclude,
    Investigation,
)
from hypothesis_engine.models import FaultKind, Observation
from hypothesis_engine.physics.frequencies import fault_frequencies, shaft_hz
from hypothesis_engine.physics.signatures import (
    ImpactTrain,
    OrderSuspect,
    Signature,
    Tone,
    predicted_signature,
)
from hypothesis_engine.physics.synth import synthesize

# A mild bearing fault under heavy noise: the physics leans one way between the
# two races but cannot settle it without a measurement.
AMBIGUOUS = {"severity": 0.35, "extra_noise": 0.45, "seed": 555}


def _first_look(fault: FaultKind, **capture) -> Investigation:
    inv = Investigation(BENCH_RIG, synthetic_capture(fault, BENCH_RIG, **capture))
    inv.observe()
    inv.run_virtual_experiments()
    return inv


def _ball_defect_capture() -> Observation:
    """Impacts at twice the ball-spin frequency: a fault the catalogue does not list."""
    fr = shaft_hz(1798.0)
    ff = fault_frequencies(BENCH_RIG.bearing, 1798.0)
    sig = Signature(
        FaultKind.HEALTHY,
        tones=(Tone(fr, 0.25, "1x"),),
        impacts=(ImpactTrain(ff.bsf_2x, 0.8, 3_000.0, 800.0, ff.ftf, "2xBSF"),),
        noise=0.10,
    )
    return Observation("rig-01", synthesize(sig, 12_000.0, 2.0, seed=4242), 12_000.0, 1798.0)


# --------------------------------------------------------------- one distribution


def test_beliefs_always_sum_to_one():
    for fault in FaultKind:
        inv = (
            _first_look(fault, **AMBIGUOUS)
            if fault is not FaultKind.HEALTHY
            else _first_look(fault)
        )
        assert sum(inv.state.belief().values()) == pytest.approx(1.0)
        for test_id, value in (("envelope", 0.4), ("vib_10s", 0.8), ("half_order", 0.2)):
            inv.apply_outcome(test_id, value)
            assert sum(inv.state.belief().values()) == pytest.approx(1.0)


def test_a_rejected_hypothesis_can_come_back():
    inv = _first_look(FaultKind.OUTER_RACE, **AMBIGUOUS)
    # Set up the situation directly: inner race written off, outer race leading.
    beliefs = {h.kind: 0.0005 for h in inv.state.hypotheses}
    beliefs[FaultKind.INNER_RACE] = 0.02
    beliefs[FaultKind.OUTER_RACE] = 1.0 - sum(beliefs.values()) + beliefs[FaultKind.OUTER_RACE]
    for h in inv.state.hypotheses:
        h.posterior = beliefs[h.kind]
    inv._relabel()
    inner = next(h for h in inv.state.hypotheses if h.kind is FaultKind.INNER_RACE)
    assert inner.rejected

    inv.apply_outcome("envelope", -0.9)  # exactly what an inner-race fault predicts
    assert not inner.rejected
    assert inner.posterior > REJECT_BELOW
    assert any("back in contention" in line for line in inv.state.transcript)


def test_the_first_look_is_scored_once():
    inv = _first_look(FaultKind.OUTER_RACE, **AMBIGUOUS)
    inv.apply_outcome("envelope", 1.2)
    after_reading = inv.state.belief()
    again = inv.run_virtual_experiments()
    assert again == inv.fit
    assert inv.state.belief() == after_reading


def test_gauss_hermite_rule_has_unit_variance():
    assert float(np.sum(eng._GH_WEIGHTS)) == pytest.approx(1.0)
    assert float(np.sum(eng._GH_WEIGHTS * eng._GH_NODES**2)) == pytest.approx(1.0)


# --------------------------------------------------------------- the transcript


def test_the_reading_is_reported_before_the_rejections_it_causes():
    inv = _first_look(FaultKind.OUTER_RACE, **AMBIGUOUS)
    inv.apply_outcome("envelope", 1.2)
    lines = inv.state.transcript
    measured = next(i for i, line in enumerate(lines) if line.startswith("Measured env_contrast"))
    rejected_after = [
        i for i, line in enumerate(lines) if line.startswith("Rejected") and i > measured
    ]
    assert rejected_after, "the reading should reject the inner race"
    assert all(i > measured for i in rejected_after)


def test_cannot_separate_names_the_leading_suspects_in_order():
    inv = _first_look(FaultKind.OUTER_RACE, **AMBIGUOUS)
    choice = inv.choose_next_test()
    assert choice is not None
    line = inv.state.transcript[-1]
    live = [h for h in inv.state.ranked() if h.posterior >= REJECT_BELOW][:3]
    assert line.startswith("Cannot separate " + " vs ".join(h.label for h in live))


# --------------------------------------------------------------- the verdict


def test_no_verdict_below_the_bar():
    inv = _first_look(FaultKind.OUTER_RACE, **AMBIGUOUS)
    assert inv.state.leader().posterior < CONCLUDE_ABOVE
    with pytest.raises(CannotConclude):
        inv.conclude()


def test_a_case_that_runs_out_of_evidence_ends_unresolved():
    inv = Investigation(BENCH_RIG, synthetic_capture(FaultKind.OUTER_RACE, BENCH_RIG, **AMBIGUOUS))
    state = inv.run(oracle=lambda test_id: None)
    assert state.conclusion is None
    assert state.outcome == "unresolved"
    assert "needs 80%" in state.unresolved_reason
    assert "Nobody could take the requested reading" in state.unresolved_reason


def test_a_fault_outside_the_list_is_not_given_its_neighbours_name():
    inv = Investigation(BENCH_RIG, _ball_defect_capture())
    state = inv.run(oracle=lambda test_id: None)
    assert state.conclusion is None, f"named {state.conclusion and state.conclusion.root_cause}"
    assert state.outcome == "unresolved"
    assert "does not predict" in state.unresolved_reason
    gap = inv.unexplained()
    assert gap is not None
    two_bsf = fault_frequencies(BENCH_RIG.bearing, 1798.0).bsf_2x / shaft_hz(1798.0)
    assert gap.order == pytest.approx(two_bsf, rel=0.02)


def test_a_clean_fault_leaves_nothing_unexplained():
    for fault in (FaultKind.OUTER_RACE, FaultKind.INNER_RACE, FaultKind.IMBALANCE):
        inv = _first_look(fault)
        assert not inv.blockers(), inv.blockers()


def test_a_reading_that_fits_nothing_blocks_the_verdict():
    inv = _first_look(FaultKind.OUTER_RACE)
    assert not inv.blockers()
    inv.apply_outcome("vib_10s", 50.0)  # no hypothesis predicts anything near this
    assert any("fits none" in reason for reason in inv.blockers())
    with pytest.raises(CannotConclude):
        inv.conclude()


def test_the_reasoning_does_not_credit_the_leader_with_a_fit_it_did_not_have():
    inv = _first_look(FaultKind.OUTER_RACE, **AMBIGUOUS)
    first_best = max(inv.fit, key=inv.fit.get)
    assert first_best == "inner_race", "this case starts out leaning the wrong way"

    inv.apply_outcome("envelope", 1.2)  # what an outer-race fault predicts
    conclusion = inv.conclude()
    assert conclusion.root_cause is FaultKind.OUTER_RACE
    reasoning = conclusion.reasoning.lower()
    assert "inner race explained the first capture best" in reasoning
    assert "favoured outer race" in reasoning
    assert "outer race explained the measured lines best" not in reasoning


# --------------------------------------------------------------- written suspects


def _cage_fault() -> OrderSuspect:
    return OrderSuspect(
        name="cage_fault",
        description="A damaged cage modulates the vibration at cage speed.",
        impacts=((0.4, 3.0, None, None),),
    )


def test_the_order_evidence_arrives_in_does_not_change_the_belief():
    # Bayes' rule commutes: a suspect added before a reading and one added
    # after it must end up with the same beliefs, because a late suspect is
    # scored on every reading already taken.
    before = _first_look(FaultKind.OUTER_RACE)
    assert before.add_hypothesis(_cage_fault())[0]
    before.apply_outcome("envelope", 0.6)

    after = _first_look(FaultKind.OUTER_RACE)
    after.apply_outcome("envelope", 0.6)
    assert after.add_hypothesis(_cage_fault())[0]

    for name, p in before.state.beliefs().items():
        assert after.state.beliefs()[name] == pytest.approx(p, rel=1e-9, abs=1e-12)


def test_a_written_suspect_keeps_the_beliefs_a_distribution():
    inv = _first_look(FaultKind.OUTER_RACE)
    accepted, why = inv.add_hypothesis(_cage_fault())
    assert accepted, why
    assert sum(inv.state.beliefs().values()) == pytest.approx(1.0)
    assert inv.hypothesis("cage_fault").origin == "written"


def test_a_suspect_buried_in_noise_is_refused_as_untestable():
    # Under heavy noise a weak cage fault predicts nothing a capture could
    # separate from a healthy machine, so testing it would prove nothing.
    inv = _first_look(FaultKind.OUTER_RACE, **AMBIGUOUS)
    accepted, why = inv.add_hypothesis(
        OrderSuspect("faint_cage", "A barely damaged cage.", impacts=((0.4, 0.5, None, None),))
    )
    assert not accepted
    assert "sets it apart" in why


def test_an_existing_fault_under_a_new_name_is_refused():
    inv = _first_look(FaultKind.OUTER_RACE)
    accepted, why = inv.add_hypothesis(
        OrderSuspect(
            name="heavy_spot",
            description="Imbalance at about half the catalogue's strength, renamed.",
            tones=((1.0, 3.0), (2.0, 0.12)),
        )
    )
    assert not accepted
    assert "imbalance" in why
    assert all(h.name != "heavy_spot" for h in inv.state.hypotheses)


def test_a_newcomer_is_measured_on_the_lines_it_predicts():
    # A fan with seven blades puts a tone at 7x, a line no catalogue hypothesis
    # predicts. The suspect written for it predicts the normal running tones as
    # well, so on the catalogue's lines it is the healthy machine exactly; only
    # its own 7x line can set it apart. It must be scored on that line.
    healthy = predicted_signature(FaultKind.HEALTHY, BENCH_RIG, 1798.0)
    fr = shaft_hz(1798.0)
    sig = Signature(
        FaultKind.HEALTHY, tones=healthy.tones + (Tone(7 * fr, 1.0, "blade pass"),), noise=0.10
    )
    capture = Observation("rig-01", synthesize(sig, 12_000.0, 2.0, seed=31), 12_000.0, 1798.0)
    inv = Investigation(BENCH_RIG, capture)
    inv.observe()
    inv.run_virtual_experiments()

    accepted, why = inv.add_hypothesis(
        OrderSuspect(
            "blade_pass",
            "Seven fan blades passing a strut, on an otherwise normal machine.",
            tones=((2.0, 0.24), (7.0, 4.0)),
        )
    )
    assert accepted, why
    assert inv.state.leader().name == "blade_pass"
