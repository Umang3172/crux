"""Scoring by simulated likelihood, checked against a machine the simulator did not build.

`independent_capture` below is a separate model of the bench machine, written by
hand from the fault descriptions in docs/DOMAIN.md rather than from
`physics/signatures.py`: different tone heights, a different resonance and
damping, its own impact generator with 1.5 % random slip, a coloured noise floor,
a 120 Hz electrical line, and a tachometer that reads 0.5 % low. It is still
synthetic, so passing here is not proof on hardware; it does mean the engine is
not being scored against the generator it simulates with.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from hypothesis_engine.data.rig import BENCH_RIG, synthetic_capture
from hypothesis_engine.investigation.engine import CONCLUDE_ABOVE, Investigation
from hypothesis_engine.models import FaultKind, Observation
from hypothesis_engine.physics.frequencies import fault_frequencies
from hypothesis_engine.physics.likelihood import (
    LINE_TOLERANCE,
    false_alarm_threshold,
    line_height,
    noise_level,
)
from hypothesis_engine.signals.features import magnitude_spectrum

FS = 12_000.0
RPM = 1798.0

# Tone heights (relative to a 0.3 running 1x) per fault, from the qualitative
# descriptions in docs/DOMAIN.md; deliberately not the numbers in signatures.py.
TONES: dict[FaultKind, dict[float, float]] = {
    FaultKind.HEALTHY: {1.0: 0.3, 2.0: 0.04},
    FaultKind.IMBALANCE: {1.0: 1.6, 2.0: 0.15},
    FaultKind.MISALIGNMENT: {1.0: 0.7, 2.0: 1.3, 3.0: 0.5},
    FaultKind.LOOSENESS: {0.5: 0.4, 1.0: 0.9, 1.5: 0.3, 2.0: 0.6, 3.0: 0.5, 4.0: 0.35, 5.0: 0.3},
    FaultKind.OUTER_RACE: {1.0: 0.3},
    FaultKind.INNER_RACE: {1.0: 0.3},
}


def _impacts(rate_hz: float, amp: float, n: int, rng: np.random.Generator, modulation_hz=None):
    out = np.zeros(n)
    ring_t = np.arange(int(FS * 0.006)) / FS
    ring = np.exp(-1_100.0 * ring_t) * np.sin(2 * np.pi * 2_400.0 * ring_t)
    t = 0.0
    while True:
        t += (1.0 / rate_hz) * (1.0 + rng.normal(0.0, 0.015))
        i = int(t * FS)
        if i >= n:
            return out
        a = amp
        if modulation_hz:
            a *= 0.5 + 0.5 * math.cos(2 * np.pi * modulation_hz * t)
        out[i : i + ring.size] += a * ring[: max(0, min(ring.size, n - i))]


def independent_capture(fault: FaultKind, level: float, seed: int) -> Observation:
    """`level` scales the fault (1 = clearly present, 0.3 = mild)."""
    rng = np.random.default_rng(seed)
    n = int(FS * 2.0)
    t = np.arange(n) / FS
    fr = RPM / 60.0
    x = np.zeros(n)
    healthy = TONES[FaultKind.HEALTHY]
    for order, amp in TONES[fault].items():
        base = healthy.get(order, 0.0)
        x += (base + level * (amp - base)) * np.sin(
            2 * np.pi * order * fr * t + rng.uniform(0, 6.3)
        )
    ff = fault_frequencies(BENCH_RIG.bearing, RPM)
    if fault is FaultKind.OUTER_RACE:
        x += _impacts(ff.bpfo, 0.8 * level, n, rng)
    if fault is FaultKind.INNER_RACE:
        x += _impacts(ff.bpfi, 0.8 * level, n, rng, modulation_hz=fr)
    x += 0.10 * np.sin(2 * np.pi * 120.0 * t)  # electrical, not shaft-locked
    pink = np.cumsum(rng.normal(0.0, 1.0, n))
    pink -= np.linspace(pink[0], pink[-1], n)
    x += 0.03 * pink / pink.std() + rng.normal(0.0, 0.14, n)
    return Observation("independent", x, FS, RPM * 0.995, source="independent model")


def _leader_after_first_look(obs: Observation):
    inv = Investigation(BENCH_RIG, obs)
    inv.observe()
    inv.run_virtual_experiments()
    return inv.state.leader(), inv


# ------------------------------------------------------------------ the cases that used to fail


@pytest.mark.parametrize("fault", [FaultKind.HEALTHY, FaultKind.IMBALANCE])
def test_the_first_look_no_longer_blames_the_outer_race(fault: FaultKind):
    # Before simulated likelihoods, both of these led with outer race
    # (0.546 and 0.566 against 0.499 and 0.500): absence of envelope peaks
    # could not count as evidence.
    leader, _ = _leader_after_first_look(synthetic_capture(fault, BENCH_RIG))
    assert leader.kind is fault


# ------------------------------------------------------------------ an independent machine


@pytest.mark.parametrize("fault", [k for k in FaultKind if k is not FaultKind.HEALTHY])
def test_a_clear_fault_leads_on_a_machine_the_simulator_did_not_build(fault: FaultKind):
    leader, _ = _leader_after_first_look(independent_capture(fault, level=1.0, seed=3))
    assert leader.kind is fault


def test_a_healthy_machine_is_never_confidently_called_faulty():
    # Healthy and mildly unbalanced differ only in the absolute height of 1x,
    # and without this machine's own baseline that height means little. So the
    # first look may split between them; what it must not do is name a fault.
    for seed in (3, 4, 5, 6):
        _, inv = _leader_after_first_look(independent_capture(FaultKind.HEALTHY, 1.0, seed))
        faults = [h for h in inv.state.hypotheses if h.kind is not FaultKind.HEALTHY]
        assert max(h.posterior for h in faults) < CONCLUDE_ABOVE
        assert inv.state.belief()[FaultKind.HEALTHY] > 0.3


def test_never_confidently_wrong_on_the_independent_machine():
    wrong = []
    for fault in FaultKind:
        for level in (1.0, 0.5, 0.3):
            for seed in (11, 12, 13):
                leader, _ = _leader_after_first_look(independent_capture(fault, level, seed))
                if leader.posterior >= CONCLUDE_ABOVE and leader.kind is not fault:
                    wrong.append((fault.value, level, seed, leader.kind.value))
    assert not wrong, f"confident and wrong: {wrong}"


# ------------------------------------------------------------------ the pieces


def test_line_height_reads_a_tone_and_reads_nothing_where_there_is_none():
    t = np.arange(int(FS * 2)) / FS
    x = np.sin(2 * np.pi * 60.0 * t) + np.random.default_rng(0).normal(0, 0.1, t.size)
    freqs, mag = magnitude_spectrum(x, FS)
    assert line_height(freqs, mag, 60.0) > 1.5  # well over ten times its floor
    assert line_height(freqs, mag, 97.0) < 0.6  # noise: within a few times its floor
    # A line slipped by less than the tolerance is still found.
    assert line_height(freqs, mag, 60.0 * (1 - 0.8 * LINE_TOLERANCE)) > 1.5


def test_noise_level_recovers_the_noise_it_was_given():
    rng = np.random.default_rng(1)
    for sigma in (0.05, 0.3, 1.0):
        x = rng.normal(0.0, sigma, int(FS * 2))
        assert noise_level(x, FS, RPM / 60.0) == pytest.approx(sigma, rel=0.1)


def test_false_alarm_threshold_matches_its_formula():
    # One bin: P(power/median > x) = exp(-x ln 2) = rate.
    assert false_alarm_threshold(1, 0.01) == pytest.approx(-math.log(0.01) / math.log(2))
    # More bins means more chances, so a higher line is needed.
    assert false_alarm_threshold(800, 0.01) > false_alarm_threshold(100, 0.01)


def test_the_threshold_holds_its_false_alarm_rate_on_white_noise():
    rng = np.random.default_rng(2)
    from hypothesis_engine.signals.features import envelope_spectrum

    trials, alarms = 200, 0
    for _ in range(trials):
        freqs, mag = envelope_spectrum(rng.normal(0, 1, int(FS * 2)), FS)
        scan = (freqs >= 10.0) & (freqs <= 400.0)
        power = mag[scan] ** 2
        ratio = power / np.median(power)
        alarms += bool(ratio.max() > false_alarm_threshold(int(scan.sum()), 0.01))
    # Designed for 1 % per capture; allow sampling error on 200 trials.
    assert alarms / trials < 0.05


def test_a_sensor_that_cannot_see_the_resonance_band_is_scored_on_shaft_lines_only():
    # The bench rig's accelerometer samples at 2 kHz: shaft orders are visible,
    # the 1.5-5 kHz bearing resonance is not. Envelope lines must be left out,
    # not read from the raw spectrum under another name.
    from dataclasses import replace

    from hypothesis_engine.physics.likelihood import envelope_visible

    rig_2k = replace(BENCH_RIG, sample_rate_hz=2_000.0)
    assert not envelope_visible(2_000.0)
    assert envelope_visible(12_000.0)

    for fault in (FaultKind.IMBALANCE, FaultKind.MISALIGNMENT, FaultKind.LOOSENESS):
        obs = synthetic_capture(fault, rig_2k)
        inv = Investigation(rig_2k, obs)
        inv.observe()
        inv.run_virtual_experiments()
        assert inv.state.leader().kind is fault
        assert inv.unexplained() is None
