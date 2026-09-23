"""The physics has to match published numbers, or nothing above it is worth much."""

from __future__ import annotations

import pytest

from hypothesis_engine.models import SKF_6205_2RS_JEM
from hypothesis_engine.physics.frequencies import (
    bearing_multipliers,
    fault_frequencies,
    shaft_hz,
)

# Published by the CWRU Bearing Data Center for the 6205-2RS JEM drive-end bearing.
CWRU_PUBLISHED = {"bpfi": 5.4152, "bpfo": 3.5848, "ftf": 0.3983, "bsf_2x": 4.7135}


def test_multipliers_match_cwru_published_values():
    m = bearing_multipliers(SKF_6205_2RS_JEM)
    assert m["bpfo"] == pytest.approx(CWRU_PUBLISHED["bpfo"], abs=1e-3)
    assert m["bpfi"] == pytest.approx(CWRU_PUBLISHED["bpfi"], abs=1e-3)
    assert m["ftf"] == pytest.approx(CWRU_PUBLISHED["ftf"], abs=1e-3)
    assert 2 * m["bsf"] == pytest.approx(CWRU_PUBLISHED["bsf_2x"], abs=2e-3)


def test_bpfo_and_bpfi_sum_to_ball_count_times_shaft():
    """A useful identity: BPFO + BPFI = n x shaft speed."""
    ff = fault_frequencies(SKF_6205_2RS_JEM, 1797.0)
    n = SKF_6205_2RS_JEM.n_rolling_elements
    assert ff.bpfo + ff.bpfi == pytest.approx(n * ff.shaft, rel=1e-9)


def test_frequencies_scale_linearly_with_speed():
    slow = fault_frequencies(SKF_6205_2RS_JEM, 900.0)
    fast = fault_frequencies(SKF_6205_2RS_JEM, 1800.0)
    assert fast.bpfo == pytest.approx(2 * slow.bpfo, rel=1e-9)
    assert shaft_hz(1800.0) == pytest.approx(30.0)
