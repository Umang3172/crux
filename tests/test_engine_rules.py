"""The rules the engine keeps whatever the scoring: one belief distribution, no
verdict below the bar, nothing unexplained left behind a verdict, and words that
match the ledger."""

from __future__ import annotations

import numpy as np
import pytest

from hypothesis_engine.data.rig import (
    BENCH_RIG,
    UNLISTED_IMPACT_ORDER,
    rig_oracle,
    synthetic_capture,
)
from hypothesis_engine.investigation import engine as eng
from hypothesis_engine.investigation.catalog import BY_ID
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

# A faint bearing fault under heavy noise: the first look cannot tell it from a
# healthy machine, let alone name the race.
AMBIGUOUS = {"severity": 0.35, "extra_noise": 0.45, "seed": 555}

# An inner-race fault the first look takes for a healthy machine, and that one
# requested capture settles: the machine's state, and the seed of its first capture.
MODERATE = {"severity": 0.5, "extra_noise": 0.45}
MODERATE_SEED = 555


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
        tones=(Tone(fr, 0.25, "1x"), Tone(2 * fr, 0.06, "2x")),
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
    assert "no hypothesis on the list predicts" in state.unresolved_reason
    gap, missed_by = inv.blocking_gap()
    assert missed_by is None, "every hypothesis leaves it out, not just the leader"
    two_bsf = fault_frequencies(BENCH_RIG.bearing, 1798.0).bsf_2x / shaft_hz(1798.0)
    assert gap.order == pytest.approx(two_bsf, rel=0.02)


def test_no_reading_is_bought_for_an_impact_no_hypothesis_predicts():
    # Below the bar the engine would normally ask for a measurement. But a
    # reading only moves belief among the hypotheses on the list, and none of
    # them predicts these impacts, so none of them could ever be concluded: the
    # engine says so at once instead of spending a technician's time.
    capture = synthetic_capture("rolling_element", BENCH_RIG, seed=1, extra_noise=0.45)
    inv = Investigation(BENCH_RIG, capture)
    inv.observe()
    inv.run_virtual_experiments()
    assert inv.state.leader().posterior < CONCLUDE_ABOVE, "the case this test needs"

    assert inv.advance() is None, "no measurement requested"
    state = inv.state
    assert state.outcome == "unresolved"
    assert state.requested_tests == []
    assert "No measurement on the menu addresses what is unexplained" in state.unresolved_reason
    assert any("the list is missing a cause" in line for line in state.transcript)


def test_a_suspect_that_predicts_the_impacts_lifts_the_block():
    inv = Investigation(BENCH_RIG, synthetic_capture("unlisted_impact", BENCH_RIG))
    inv.observe()
    inv.run_virtual_experiments()
    gap, missed_by = inv.blocking_gap()
    assert missed_by is None
    assert gap.order == pytest.approx(UNLISTED_IMPACT_ORDER, rel=0.02)

    accepted, why = inv.add_hypothesis(
        OrderSuspect("rub", "A rub striking 7.6 times a turn.", impacts=((7.6, 4.0, None, None),))
    )
    assert accepted, why
    assert inv.blocking_gap() is None
    assert inv.state.leader().name == "rub"
    assert not inv.blockers()


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
    # A moderate inner-race fault whose first capture fits a healthy machine
    # best. Which seeds lean that way moves with the speed estimate, so take the
    # first of a few that does rather than lean on one.
    for seed in (111, 41, 61):
        capture = synthetic_capture(FaultKind.INNER_RACE, BENCH_RIG, seed=seed, **MODERATE)
        inv = Investigation(BENCH_RIG, capture)
        state = inv.run(oracle=rig_oracle(FaultKind.INNER_RACE, BENCH_RIG, **MODERATE))
        if max(inv.fit, key=inv.fit.get) == "healthy":
            break
    else:
        pytest.fail("no case here starts out leaning the wrong way")

    conclusion = state.conclusion
    assert conclusion is not None, state.unresolved_reason
    assert conclusion.root_cause is FaultKind.INNER_RACE
    reasoning = conclusion.reasoning.lower()
    assert "healthy explained the first capture best" in reasoning
    assert "favoured inner race" in reasoning
    assert "inner race explained the measured lines best" not in reasoning


# --------------------------------------------------------------- what a test would read


def _prediction(inv: Investigation, test_id: str, name: str) -> np.ndarray:
    means, _ = inv._reading_prediction(BY_ID[test_id], inv.hypothesis(name))
    return means


def test_what_a_capture_will_read_is_simulated_for_every_hypothesis():
    inv = _first_look(FaultKind.INNER_RACE, seed=MODERATE_SEED, **MODERATE)
    outer = _prediction(inv, "envelope", "outer_race")
    inner = _prediction(inv, "envelope", "inner_race")
    healthy = _prediction(inv, "envelope", "healthy")
    # One value per simulated severity; the stronger the fault, the further the
    # reading sits from what a healthy machine gives, each race on its own side.
    assert len(outer) == len(inner) == 5 and len(healthy) == 1
    assert np.all(np.diff(outer) > 0) and np.all(np.diff(inner) < 0)
    assert outer[-1] > 1.0 and inner[-1] < -1.0 and abs(healthy[0]) < 0.2
    # A faint fault reads close to a healthy machine: the table this replaced
    # gave +1.20 and -0.90 whatever the severity or the noise.
    assert abs(outer[0]) < 0.5 and abs(inner[0]) < 0.5


def test_an_honest_reading_moves_belief_toward_the_true_cause():
    for fault, test_id in (
        (FaultKind.OUTER_RACE, "envelope"),
        (FaultKind.INNER_RACE, "envelope"),
        (FaultKind.MISALIGNMENT, "vib_10s"),
        (FaultKind.LOOSENESS, "half_order"),
        (FaultKind.IMBALANCE, "coast_down"),
    ):
        inv = _first_look(fault, seed=11, **MODERATE)
        before = inv.state.beliefs()[fault.value]
        inv.apply_outcome(test_id, rig_oracle(fault, BENCH_RIG, **MODERATE)(test_id))
        assert inv.state.beliefs()[fault.value] >= before - 1e-9, (fault, test_id)


def test_the_rig_answers_from_the_machine_it_was_given_not_a_clean_copy():
    faint = rig_oracle(FaultKind.OUTER_RACE, BENCH_RIG, **{k: AMBIGUOUS[k] for k in MODERATE})
    full = rig_oracle(FaultKind.OUTER_RACE, BENCH_RIG)
    assert faint("envelope") < 0.5 * full("envelope")
    assert faint("temperature") < 0.5 * full("temperature")


def test_a_small_reading_does_not_count_against_a_small_fault():
    # The catalogue's temperature table is for a full-strength fault. A faint
    # one warms the housing only a little, so a small rise must not rule it out.
    inv = _first_look(FaultKind.OUTER_RACE, **AMBIGUOUS)
    before = inv.state.beliefs()["outer_race"]
    inv.apply_outcome("temperature", 3.5)
    assert inv.state.beliefs()["outer_race"] >= before


def test_a_capture_is_scored_at_its_own_length():
    # The same fault reads further from zero in a longer capture, which resolves
    # its line further above the floor. So a capture handed over is scored
    # against simulations of its own length, not the length the test asks for.
    inv = _first_look(FaultKind.INNER_RACE, seed=MODERATE_SEED, **MODERATE)
    inner, test = inv.hypothesis("inner_race"), BY_ID["envelope"]
    short = synthetic_capture(FaultKind.INNER_RACE, BENCH_RIG, seed=99, duration_s=4.0, **MODERATE)
    asked_for, _ = inv._reading_prediction(test, inner)
    at_its_length, _ = inv._reading_prediction(test, inner, n=len(short.waveform))
    assert asked_for[-1] < at_its_length[-1] - 0.2 < 0.0

    value = inv.apply_capture("envelope", short)
    assert value == pytest.approx(inv.measure_from_capture("envelope", short))
    assert inv._readings[-1].n == len(short.waveform)
    as_number = _first_look(FaultKind.INNER_RACE, seed=MODERATE_SEED, **MODERATE)
    as_number.apply_outcome("envelope", value)
    assert as_number.state.beliefs() != inv.state.beliefs()

    with pytest.raises(ValueError, match="a person reports it"):
        inv.apply_capture("temperature", short)


def test_what_a_test_is_expected_to_read_follows_the_severity_the_capture_shows():
    # Both captures are too noisy to settle; the stronger fault's evidence points
    # to a higher severity, so the engine expects a larger reading from it.
    expected = {}
    for severity in (0.35, 0.75):
        inv = _first_look(FaultKind.INNER_RACE, severity=severity, extra_noise=0.6, seed=11)
        model = inv._reading_model(BY_ID["envelope"], [inv.hypothesis("inner_race")])
        weights = inv._severity_weights(inv.hypothesis("inner_race"))
        expected[severity] = float(weights @ model.means[0])
    assert expected[0.75] < expected[0.35] - 0.2


def test_a_test_that_cannot_settle_the_case_is_not_bought():
    inv = _first_look(FaultKind.INNER_RACE, seed=MODERATE_SEED, **MODERATE)
    first, second = inv.state.ranked()[:2]
    assert {first.name, second.name} == {"healthy", "inner_race"}
    # With the envelope, temperature and coast-down taken, what is left reads
    # shaft tones, which a healthy machine and an inner-race fault share.
    inv.state.requested_tests += ["envelope", "temperature", "coast_down"]
    assert inv.choose_next_test() is None
    assert "No measurement on the menu can settle it" in inv.no_useful_test
    assert inv.advance() is None
    assert inv.state.outcome == "unresolved"
    assert "No measurement on the menu can settle it" in inv.state.unresolved_reason


def test_a_healthy_verdict_says_what_it_could_not_have_seen():
    # A faint outer-race fault whose impacts do not show in this capture: it is
    # called healthy, and the verdict names the faults it cannot exclude.
    inv = _first_look(FaultKind.OUTER_RACE, severity=0.25, extra_noise=0.25, seed=11)
    assert inv.state.leader().kind is FaultKind.HEALTHY
    assert "outer_race" in [h.name for h, _ in inv.cannot_exclude()]
    conclusion = inv.conclude()
    assert "outer race at severity 0.25" in conclusion.reasoning
    assert "cannot be excluded" in conclusion.reasoning

    clear = _first_look(FaultKind.HEALTHY)
    assert "outer_race" not in [h.name for h, _ in clear.cannot_exclude()]


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
            tones=((1.0, 3.0), (2.0, 0.48)),
        )
    )
    assert not accepted
    assert "imbalance" in why
    assert all(h.name != "heavy_spot" for h in inv.state.hypotheses)
    assert inv.ledger.items[-1].statement == f"written suspect heavy spot refused: {why}"


def test_a_suspect_the_capture_cannot_contain_is_refused_on_the_record():
    inv = _first_look(FaultKind.OUTER_RACE)
    before = inv.state.beliefs()
    accepted, why = inv.add_hypothesis(
        OrderSuspect("gear_mesh", "A gear mesh far above this sensor.", tones=((500.0, 1.0),))
    )
    assert not accepted
    assert why.startswith("A tone at 500x") and "above 6000 Hz" in why
    assert inv.ledger.items[-1].statement == f"written suspect gear mesh refused: {why}"
    assert inv.state.beliefs() == before


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
