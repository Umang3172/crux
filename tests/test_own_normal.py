"""A machine whose normal is not the textbook's, scored against its own normal.

The rig here has always run with its 2x taller than its 1x and a run of
harmonics, and its noise is quiet near the shaft lines and loud higher up, the
way an accelerometer on a real machine shows it. The textbook machine in
`physics.signatures` has neither quirk, so without the rig's own healthy
captures a healthy machine reads as misaligned.

The captures are built here, tone by tone, not by `data.rig`: the rig's own
normal plus what each fault adds, in whatever units the sensor reports.
"""

from __future__ import annotations

import numpy as np
import pytest
from scipy.signal import butter, sosfilt

from hypothesis_engine.data.rig import BENCH_RIG, UNLISTED_IMPACT_ORDER
from hypothesis_engine.investigation.catalog import BY_ID
from hypothesis_engine.investigation.engine import LEVEL_RISE, Investigation
from hypothesis_engine.models import FaultKind, Observation
from hypothesis_engine.physics.frequencies import shaft_hz
from hypothesis_engine.physics.likelihood import (
    FLAT_NOISE,
    Line,
    Noise,
    noise_profile,
    read_lines,
)
from hypothesis_engine.physics.normal import restate_reading
from hypothesis_engine.physics.signatures import (
    ImpactTrain,
    OrderSuspect,
    Signature,
    Tone,
    predicted_signature,
)
from hypothesis_engine.physics.synth import synthesize
from hypothesis_engine.signals.features import magnitude_spectrum
from hypothesis_engine.tools.cases import InMemoryCaseStore, open_case, record_measurement

FS = BENCH_RIG.sample_rate_hz
RPM = BENCH_RIG.nominal_rpm

#: This rig's own running tones, by shaft order. The textbook has 0.25 at 1x and
#: 0.06 at 2x and nothing else.
OWN_TONES = {1.0: 0.25, 2.0: 0.40, 3.0: 0.15, 4.0: 0.08}


def rig_capture(
    fault: FaultKind = FaultKind.HEALTHY,
    severity: float = 1.0,
    seed: int = 5,
    duration_s: float = 2.0,
    gain: float = 1.0,
    noise: float = 0.15,
    tilted: bool = True,
    own_impacts: float = 0.0,
    tones: dict[float, float] | None = None,
) -> Observation:
    """The quirky rig with `fault` added to its own normal, in sensor units `gain`."""
    fr = shaft_hz(RPM)
    added = predicted_signature(fault, BENCH_RIG, RPM, severity=severity)
    textbook = {
        round(t.freq_hz / fr, 3): t.amp
        for t in predicted_signature(FaultKind.HEALTHY, BENCH_RIG, RPM).tones
    }
    amps = dict(OWN_TONES) | (tones or {})
    for tone in added.tones:
        order = round(tone.freq_hz / fr, 3)
        amps[order] = amps.get(order, 0.0) + tone.amp - textbook.get(order, 0.0)
    impacts = added.impacts
    if own_impacts:
        impacts += (ImpactTrain(UNLISTED_IMPACT_ORDER * fr, own_impacts, label="its own"),)
    clean = Signature(fault, tuple(Tone(o * fr, a) for o, a in amps.items()), impacts, noise=0.0)
    x = synthesize(clean, FS, duration_s, seed=seed)
    rng = np.random.default_rng(seed + 1)
    hiss = rng.normal(0.0, noise, len(x))
    if tilted:  # little of it near the shaft lines, most of it above 1 kHz
        high = sosfilt(butter(1, 1000.0, btype="highpass", fs=FS, output="sos"), hiss)
        hiss = 1.3 * high + rng.normal(0.0, 0.08 * noise, len(x))
    return Observation(BENCH_RIG.machine_id, (x + hiss) * gain, FS, RPM + float(rng.normal(0, 1.5)))


def normal(count: int = 4, **how) -> list[Observation]:
    return [rig_capture(seed=1000 + k, **how) for k in range(count)]


def investigate(fault: FaultKind, severity: float = 1.0, own: bool = True, **how):
    inv = Investigation(
        BENCH_RIG, rig_capture(fault, severity, **how), normal=normal(**how) if own else ()
    )

    def answer(test_id: str) -> Observation | None:
        test = BY_ID[test_id]
        if test.capture_s is None:
            return None
        return rig_capture(fault, severity, seed=99, duration_s=test.capture_s, **how)

    return inv, inv.run(oracle=answer)


# ---------------------------------------------------------------- the failure, and the fix


def test_the_textbook_machine_calls_this_healthy_rig_misaligned():
    # The premise of everything below. If the textbook mode ever stops being
    # fooled by a rig like this, the tests below prove less than they say.
    _, state = investigate(FaultKind.HEALTHY, own=False)
    assert state.leader().kind is FaultKind.MISALIGNMENT
    assert state.leader().posterior > 0.9


def test_against_its_own_normal_the_healthy_rig_is_given_no_fault():
    inv, state = investigate(FaultKind.HEALTHY)
    assert state.leader().kind is FaultKind.HEALTHY
    assert state.conclusion is None or state.conclusion.root_cause is FaultKind.HEALTHY
    assert state.extra["own_normal"]["captures"] == 4
    assert any("own normal" in line for line in state.transcript)


@pytest.mark.parametrize(
    ("fault", "severity"),
    [
        (FaultKind.OUTER_RACE, 1.0),
        (FaultKind.INNER_RACE, 0.5),
        (FaultKind.IMBALANCE, 0.5),
        (FaultKind.MISALIGNMENT, 0.5),
        (FaultKind.LOOSENESS, 0.5),
    ],
)
def test_against_its_own_normal_a_fault_is_named_for_what_it_adds(fault, severity):
    _, state = investigate(fault, severity)
    assert state.conclusion is not None, state.unresolved_reason
    assert state.conclusion.root_cause is fault


def test_misalignment_is_not_mistaken_for_imbalance_on_a_rig_with_a_tall_2x():
    # The rig's 2x is already 0.40. A fault adding 0.5 there is a small step in
    # height (x2.3) but a large one in amplitude. Amplitudes add: scored as a
    # change in height, the same capture reads as imbalance.
    inv, state = investigate(FaultKind.MISALIGNMENT, 0.5)
    assert state.leader().kind is FaultKind.MISALIGNMENT
    assert inv.hypothesis("imbalance").posterior < 0.05


@pytest.mark.parametrize("gain", [0.01, 37.0])
def test_the_verdict_does_not_depend_on_the_sensors_units(gain):
    for fault, severity in ((FaultKind.HEALTHY, 1.0), (FaultKind.IMBALANCE, 0.5)):
        _, in_model_units = investigate(fault, severity)
        _, in_sensor_units = investigate(fault, severity, gain=gain)
        assert in_sensor_units.leader().kind is in_model_units.leader().kind is fault
        a, b = in_model_units.leader().posterior, in_sensor_units.leader().posterior
        assert abs(a - b) < 0.1


def test_one_healthy_capture_is_enough_to_stop_the_false_alarm():
    inv = Investigation(BENCH_RIG, rig_capture(), normal=normal(1))
    state = inv.run()
    assert state.leader().kind is FaultKind.HEALTHY


def test_a_normal_capture_sampled_differently_is_refused():
    other = rig_capture(seed=1)
    other = Observation(other.machine_id, other.waveform, FS / 2, other.rpm)
    with pytest.raises(ValueError, match="normal capture is sampled"):
        Investigation(BENCH_RIG, rig_capture(), normal=[other])


# ---------------------------------------------------------------- noise that is not flat


def _floor(x: np.ndarray, low_hz: float, high_hz: float) -> float:
    freqs, mag = magnitude_spectrum(x, FS)
    return float(np.median(mag[(freqs >= low_hz) & (freqs <= high_hz)]))


def test_white_noise_is_reported_as_flat_and_tilted_noise_is_not():
    fr = shaft_hz(RPM)
    white = noise_profile(rig_capture(tilted=False).waveform, FS, fr)
    assert white.low is None
    tilted = noise_profile(rig_capture().waveform, FS, fr)
    assert tilted.low is not None
    quiet, up_to = tilted.low
    assert tilted.level / quiet > FLAT_NOISE and up_to == pytest.approx(6.5 * fr)
    # The two levels are the capture's own floors, read where the lines are read.
    measured = _floor(rig_capture().waveform, 2000, 5000) / _floor(rig_capture().waveform, 8, up_to)
    assert tilted.level / quiet == pytest.approx(measured, rel=0.25)


def test_the_simulator_makes_noise_at_the_two_levels_it_is_given():
    fr = shaft_hz(RPM)
    noise = Noise(0.5, (0.05, 6.5 * fr))
    x = synthesize(noise.on(Signature(None)), FS, 4.0, seed=3)
    assert _floor(x, 2000, 5000) / _floor(x, 8, 6.5 * fr) == pytest.approx(10.0, rel=0.2)
    back = noise_profile(x, FS, fr)
    assert back.level == pytest.approx(0.5, rel=0.15)
    assert back.low[0] == pytest.approx(0.05, rel=0.25)


def test_a_bearing_fault_under_tilted_noise_is_still_named():
    # With the simulator's floor set from the quiet shaft lines alone, an inner
    # race at half strength predicts lines far taller than the loud band lets
    # through, and the case ends unresolved on a line nobody explains.
    _, state = investigate(FaultKind.INNER_RACE, 0.5)
    assert state.conclusion is not None, state.unresolved_reason
    assert state.conclusion.root_cause is FaultKind.INNER_RACE


# ---------------------------------------------------------------- what else the normal settles


def test_a_requested_capture_is_read_against_the_rigs_own_normal():
    capture = rig_capture(seed=77, duration_s=10.0)
    textbook = Investigation(BENCH_RIG, rig_capture())
    textbook.observe()
    textbook.run_virtual_experiments()
    read = textbook.apply_capture("vib_10s", capture)
    assert read == pytest.approx(0.40 / 0.25, rel=0.1), "the rig's own 2x over 1x"

    own = Investigation(BENCH_RIG, rig_capture(), normal=normal())
    own.observe()
    own.run_virtual_experiments()
    # Cut to the length of the healthy captures, like with like, so not identical.
    shown = own.apply_capture("vib_10s", capture)
    assert shown == pytest.approx(read, rel=0.05)
    assert own.state.outcomes[-1].value == shown, "the value shown is the one read"
    assert own.state.leader().kind is FaultKind.HEALTHY
    assert own.hypothesis("misalignment").posterior < 0.01
    assert any("change from this machine's own normal" in e.statement for e in own.ledger.items)


def test_a_ratio_to_1x_gives_up_the_rigs_own_share_as_1x_grows():
    # Own 2x/1x is 1.6 against a textbook 0.24. With 1x unchanged the whole
    # difference comes off; once 1x has doubled, half of it.
    assert restate_reading("ratio_2x_1x", 1.6, [1.6, 1.6], 0.24)[0] == pytest.approx(0.24)
    assert restate_reading("ratio_2x_1x", 0.8, [1.6, 1.6], 0.24, growth_1x=2.0)[0] == (
        pytest.approx(0.8 - (1.6 - 0.24) / 2.0)
    )
    assert restate_reading("env_contrast", 0.5, [0.1, 0.1], 0.0)[0] == pytest.approx(0.4)


def test_a_healthy_verdict_is_refused_once_the_level_has_doubled():
    # Nothing has changed at any line a listed fault predicts, but the rig is
    # far louder than it was: not a healthy machine, and no fault on the list.
    inv = Investigation(BENCH_RIG, rig_capture(noise=0.8), normal=normal())

    def answer(test_id: str) -> Observation | None:
        test = BY_ID[test_id]
        if test.capture_s is None:
            return None
        return rig_capture(seed=99, duration_s=test.capture_s, noise=0.8)

    state = inv.run(oracle=answer)
    assert inv.level_rise >= LEVEL_RISE
    assert state.leader().kind is FaultKind.HEALTHY
    assert state.outcome == "unresolved"
    assert "times its own normal" in state.unresolved_reason

    quiet = Investigation(BENCH_RIG, rig_capture(), normal=normal())
    assert quiet.level_rise < LEVEL_RISE
    assert quiet.run().outcome == "concluded"


def test_an_impact_the_rig_has_always_had_does_not_block_a_verdict():
    always = {"own_impacts": 0.6}
    seen = read_lines(
        rig_capture(**always).waveform,
        FS,
        shaft_hz(RPM),
        (Line("envelope", UNLISTED_IMPACT_ORDER),),
    )
    assert seen.heights[0] > 1.0, "the rig's own impacts stand well clear in the envelope"

    textbook = Investigation(BENCH_RIG, rig_capture(**always))
    textbook.run()
    assert textbook.unexplained_by_any() is not None

    inv = Investigation(BENCH_RIG, rig_capture(**always), normal=normal(**always))
    state = inv.run()
    assert inv.unexplained_by_any() is None
    assert state.conclusion is not None and state.conclusion.root_cause is FaultKind.HEALTHY


def _third_harmonic_case(healthy_levels: tuple[float, ...], today: float):
    healthy = [
        rig_capture(seed=1000 + k, tones={3.0: level}) for k, level in enumerate(healthy_levels)
    ]
    inv = Investigation(BENCH_RIG, rig_capture(tones={3.0: today}), normal=healthy)

    def answer(test_id: str) -> Observation | None:
        test = BY_ID[test_id]
        if test.capture_s is None:
            return None
        return rig_capture(seed=99, duration_s=test.capture_s, tones={3.0: today})

    return inv, inv.run(oracle=answer)


def test_a_tone_that_wanders_when_the_rig_is_healthy_is_not_a_fault_when_it_wanders():
    # Its 3x has stood anywhere from 0.05 to 0.25 on healthy days. 0.24 today is
    # one more of those: the spread of its own healthy captures says so.
    _, state = _third_harmonic_case((0.05, 0.25, 0.10, 0.20), today=0.24)
    assert state.conclusion is not None, state.unresolved_reason
    assert state.conclusion.root_cause is FaultKind.HEALTHY


def test_a_change_no_listed_fault_makes_is_not_given_to_the_nearest_fault():
    # The same 0.24 on a rig whose 3x has always stood at 0.15, with nothing
    # else moved. Misalignment is the nearest fault on the list and takes the
    # belief, but it also predicts a taller 2x, and 2x has not moved.
    inv, state = _third_harmonic_case((0.15, 0.15, 0.15, 0.15), today=0.24)
    assert state.leader().kind is FaultKind.MISALIGNMENT and state.leader().posterior > 0.8
    assert state.outcome == "unresolved"
    assert "does not explain the line at 2x in the spectrum" in state.unresolved_reason
    line, off = inv.misfit()
    assert line == Line("raw", 2.0) and off < -4.0


def test_a_suspect_written_for_that_change_is_tested_against_the_rigs_own_normal():
    healthy = [rig_capture(seed=1000 + k, tones={3.0: 0.15}) for k in range(4)]
    inv = Investigation(BENCH_RIG, rig_capture(tones={3.0: 0.24}), normal=healthy)
    inv.observe()
    inv.run_virtual_experiments()
    assert any("does not explain the line at 2x" in reason for reason in inv.blockers())

    accepted, _ = inv.add_hypothesis(
        OrderSuspect(
            "blade_pass",
            "Flow past the three blades: a tone at three times shaft speed.",
            tones=((3.0, 0.4),),
        )
    )
    assert accepted
    # Scored on the change from the rig's normal like everyone else: against the
    # raw capture, with its tall 2x, it would lose to misalignment.
    assert inv.state.leader().name == "blade_pass" and inv.state.leader().posterior > 0.9
    assert inv.blockers() == []
    assert inv.conclude().cause == "blade_pass"


# ---------------------------------------------------------------- through the case store


def test_a_capture_handed_to_the_case_store_is_read_and_scored_by_the_engine():
    store = InMemoryCaseStore()
    case = open_case(store, BENCH_RIG, rig_capture(), normal=normal())
    inv = case.investigation
    inv.run_virtual_experiments()
    from hypothesis_engine.investigation.engine import TestChoice
    from hypothesis_engine.tools.cases import MeasurementRequest

    inv.request(TestChoice(BY_ID["vib_10s"], 0.0, 0.0, "asked for in this test"))
    case.requests.append(MeasurementRequest(id="R1", test_id="vib_10s"))
    req = record_measurement(
        store, case.id, "R1", rig_capture(seed=77, duration_s=10.0), collected_by="sensor"
    )
    assert req.status == "answered"
    assert req.reading == pytest.approx(0.40 / 0.25, rel=0.1)
    assert inv.state.leader().kind is FaultKind.HEALTHY
