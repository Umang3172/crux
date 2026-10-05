"""A sensor that cannot see the bearing resonance band reports no envelope.

Before this guard, a 2 kHz capture silently got its raw spectrum back, labelled
as an envelope, and the investigation reasoned over it as bearing evidence.
Absent evidence must stay absent.
"""

from __future__ import annotations

import numpy as np
import pytest

from hypothesis_engine.data.rig import BENCH_RIG, BENCH_RIG_ESP32, synthetic_capture
from hypothesis_engine.investigation.catalog import BY_ID
from hypothesis_engine.investigation.engine import Investigation
from hypothesis_engine.models import FaultKind
from hypothesis_engine.signals.features import (
    ENVELOPE_FEATURES,
    EnvelopeUnavailable,
    envelope_available,
    envelope_spectrum,
    extract,
)


def test_which_sample_rates_can_see_the_band():
    assert envelope_available(12_000.0)
    assert not envelope_available(BENCH_RIG_ESP32.sample_rate_hz)


def test_the_envelope_is_refused_rather_than_faked():
    x = np.random.default_rng(0).normal(0, 1, 4_000)
    with pytest.raises(EnvelopeUnavailable):
        envelope_spectrum(x, BENCH_RIG_ESP32.sample_rate_hz)


def test_a_2khz_capture_reports_no_envelope_features():
    obs = synthetic_capture(FaultKind.IMBALANCE, BENCH_RIG_ESP32)
    ev = extract(obs, BENCH_RIG_ESP32)
    assert not ev.envelope_available
    assert ev.env_bpfo is None and ev.env_bpfi is None and ev.env_contrast() is None


def test_a_12khz_capture_still_has_its_envelope():
    ev = extract(synthetic_capture(FaultKind.OUTER_RACE, BENCH_RIG), BENCH_RIG)
    assert ev.envelope_available and ev.env_bpfo is not None


def test_the_investigation_says_so_and_never_asks_for_an_envelope():
    obs = synthetic_capture(FaultKind.IMBALANCE, BENCH_RIG_ESP32, severity=0.35, extra_noise=0.45)
    inv = Investigation(BENCH_RIG_ESP32, obs)
    state = inv.run(max_requests=5)
    assert any("envelope not available" in e.statement for e in state.ledger)
    assert not any(BY_ID[t].feature in ENVELOPE_FEATURES for t in state.requested_tests)


def test_reading_an_envelope_feature_from_a_2khz_capture_is_an_error():
    obs = synthetic_capture(FaultKind.IMBALANCE, BENCH_RIG_ESP32)
    inv = Investigation(BENCH_RIG_ESP32, obs)
    with pytest.raises(ValueError, match="envelope"):
        inv.measure_from_capture("envelope", obs)
