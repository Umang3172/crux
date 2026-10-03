"""Order tracking: frequencies are read at the speed the signal shows.

The reported speed is a nameplate figure or a tachometer reading, and either can
be a few percent off. BPFI is 5.4x shaft speed, so without these tests passing an
inner-race defect quietly reads as "not a bearing fault".
"""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest

from hypothesis_engine.data.rig import BENCH_RIG, synthetic_capture
from hypothesis_engine.investigation.engine import Investigation
from hypothesis_engine.models import FaultKind, Observation
from hypothesis_engine.signals.features import extract

TRUE_RPM = 1798.0


def _mislabelled(fault: FaultKind, error: float) -> Observation:
    """A capture taken at TRUE_RPM whose reported speed is off by `error`."""
    obs = synthetic_capture(fault, BENCH_RIG, rpm=TRUE_RPM)
    return replace(obs, rpm=TRUE_RPM * (1 + error))


@pytest.mark.parametrize("fault", list(FaultKind))
@pytest.mark.parametrize("error", [-0.035, 0.0, 0.035])
def test_speed_is_measured_from_the_signal(fault: FaultKind, error: float):
    ev = extract(_mislabelled(fault, error), BENCH_RIG)
    assert ev.speed is not None and ev.speed.from_signal
    assert ev.speed.rpm == pytest.approx(TRUE_RPM, rel=2e-3)


@pytest.mark.parametrize("error", [-0.035, 0.035])
def test_a_speed_error_no_longer_hides_an_inner_race_fault(error: float):
    """The case that started this: a 3.5% speed error used to collapse env_bpfi to ~2."""
    honest = extract(_mislabelled(FaultKind.INNER_RACE, 0.0), BENCH_RIG)
    off = extract(_mislabelled(FaultKind.INNER_RACE, error), BENCH_RIG)
    assert off.env_bpfi == pytest.approx(honest.env_bpfi, rel=0.05)
    assert off.env_contrast() < -1.0  # still points clearly at the inner race


def test_the_ledger_records_both_speeds():
    inv = Investigation(BENCH_RIG, _mislabelled(FaultKind.IMBALANCE, 0.035))
    inv.observe()
    statements = [e.statement for e in inv.ledger.items]
    assert "shaft speed, reported" in statements
    assert "shaft speed, measured from the 1x peak" in statements
    assert inv.state.rpm == pytest.approx(TRUE_RPM, rel=2e-3)


def test_with_no_shaft_peak_the_reported_speed_stands_and_says_why():
    rng = np.random.default_rng(0)
    noise = Observation("rig-01", rng.normal(0, 1, 24_000), 12_000.0, rpm=TRUE_RPM)
    ev = extract(noise, BENCH_RIG)
    assert ev.speed is not None
    assert not ev.speed.from_signal
    assert ev.speed.rpm == TRUE_RPM
    assert ev.speed.note
