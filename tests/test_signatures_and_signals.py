"""The synthesiser must put energy where the physics says, or comparison is noise."""

from __future__ import annotations

import pytest

from hypothesis_engine.data.rig import BENCH_RIG, synthetic_capture
from hypothesis_engine.models import FaultKind
from hypothesis_engine.physics.frequencies import fault_frequencies, shaft_hz
from hypothesis_engine.physics.signatures import predicted_signature
from hypothesis_engine.physics.synth import synthesize
from hypothesis_engine.signals.features import extract, magnitude_spectrum, peak_near

RPM = 1798.0


def _spectrum_peak_ratio(x, fs, f_target, f_reference):
    freqs, mag = magnitude_spectrum(x, fs)
    return peak_near(freqs, mag, f_target) / (peak_near(freqs, mag, f_reference) + 1e-12)


def test_imbalance_is_dominated_by_1x():
    sig = predicted_signature(FaultKind.IMBALANCE, BENCH_RIG, RPM)
    x = synthesize(sig, BENCH_RIG.sample_rate_hz, 2.0, seed=3)
    fr = shaft_hz(RPM)
    assert _spectrum_peak_ratio(x, BENCH_RIG.sample_rate_hz, 2 * fr, fr) < 0.35


def test_misalignment_puts_2x_above_1x():
    sig = predicted_signature(FaultKind.MISALIGNMENT, BENCH_RIG, RPM)
    x = synthesize(sig, BENCH_RIG.sample_rate_hz, 2.0, seed=3)
    fr = shaft_hz(RPM)
    assert _spectrum_peak_ratio(x, BENCH_RIG.sample_rate_hz, 2 * fr, fr) > 1.0


def test_looseness_shows_a_half_order_peak():
    obs = synthetic_capture(FaultKind.LOOSENESS, BENCH_RIG, rpm=RPM)
    ev = extract(obs, BENCH_RIG)
    assert ev.amp_half_x > 0.15


def test_outer_race_shows_up_in_the_envelope_at_bpfo():
    obs = synthetic_capture(FaultKind.OUTER_RACE, BENCH_RIG, rpm=RPM)
    ev = extract(obs, BENCH_RIG)
    healthy = extract(synthetic_capture(FaultKind.HEALTHY, BENCH_RIG, rpm=RPM), BENCH_RIG)
    assert ev.env_bpfo > healthy.env_bpfo
    assert ev.env_bpfo > 3.0


def test_bearing_faults_raise_crest_factor():
    healthy = extract(synthetic_capture(FaultKind.HEALTHY, BENCH_RIG, rpm=RPM), BENCH_RIG)
    spalled = extract(synthetic_capture(FaultKind.OUTER_RACE, BENCH_RIG, rpm=RPM), BENCH_RIG)
    assert spalled.crest_factor > healthy.crest_factor


@pytest.mark.parametrize("fault", list(FaultKind))
def test_every_hypothesis_has_a_signature(fault: FaultKind):
    sig = predicted_signature(fault, BENCH_RIG, RPM)
    assert sig.tones or sig.impacts
    ff = fault_frequencies(BENCH_RIG.bearing, RPM)
    if fault is FaultKind.OUTER_RACE:
        assert sig.impacts[0].rate_hz == pytest.approx(ff.bpfo)
    if fault is FaultKind.INNER_RACE:
        assert sig.impacts[0].rate_hz == pytest.approx(ff.bpfi)
