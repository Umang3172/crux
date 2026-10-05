"""The XJTU-SY bridge from a recorded snapshot to an investigation input."""

from __future__ import annotations

import numpy as np
import pytest

from hypothesis_engine.data import xjtu
from hypothesis_engine.forecast import runs


def test_speed_comes_from_the_condition_name() -> None:
    assert xjtu.rpm_of("35Hz12kN") == 2100.0
    assert xjtu.rpm_of("37.5Hz11kN") == 2250.0
    with pytest.raises(ValueError):
        xjtu.rpm_of("12kN")


def test_a_snapshot_becomes_an_observation_of_the_documented_rig(tmp_path) -> None:
    folder = tmp_path / "40Hz10kN" / "Bearing3_1"
    folder.mkdir(parents=True)
    x = np.sin(np.arange(64)) + 5.0
    (folder / "1.csv").write_text("H,V\n" + "\n".join(f"{a},0" for a in x) + "\n")
    (run,) = runs.xjtu_runs(tmp_path)
    m, obs = xjtu.machine(run), xjtu.observation(run, 0)
    assert m.bearing == runs.XJTU_BEARING and m.nominal_rpm == 2400.0
    assert obs.rpm == 2400.0 and obs.sample_rate_hz == runs.XJTU_FS_HZ
    assert obs.waveform.mean() == pytest.approx(0.0, abs=1e-12)  # mean removed, like every load
    assert obs.source.endswith("Bearing3_1/1.csv")
