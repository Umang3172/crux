"""The physics has to match published numbers, or nothing above it is worth much."""

from __future__ import annotations

import pytest

from hypothesis_engine.models import SKF_6205_2RS_JEM
from hypothesis_engine.physics.frequencies import (
    bearing_multipliers,
    fault_frequencies,
    kinematic_matches,
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


def test_a_line_is_matched_to_the_bearing_frequencies_it_sits_on():
    bearing = SKF_6205_2RS_JEM
    m = bearing_multipliers(bearing)

    ball = kinematic_matches(2 * m["bsf"], bearing, 0.02)
    assert [(x.frequency, x.harmonic, x.part) for x in ball] == [("2xbsf", 1, "rolling element")]

    cage = kinematic_matches(1.01 * m["ftf"], bearing, 0.02)  # a cage slipping 1 %
    assert [(x.frequency, x.part) for x in cage] == [("ftf", "cage")]
    assert cage[0].deviation == pytest.approx(0.01, abs=1e-4)

    # On this bearing 3x BPFO and 2x BPFI are 0.7 % apart: both are reported,
    # closest first, because no tolerance a slipping bearing needs can split them.
    both = kinematic_matches(3 * m["bpfo"], bearing, 0.02)
    assert [(x.frequency, x.harmonic) for x in both] == [("bpfo", 3), ("bpfi", 2)]

    assert kinematic_matches(7.6, bearing, 0.02) == []
    assert all(x.frequency != "bpfo" for x in kinematic_matches(1.03 * m["bpfo"], bearing, 0.02))
