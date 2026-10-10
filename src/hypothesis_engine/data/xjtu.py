"""XJTU-SY recordings as investigation inputs.

The forecaster says *when* a bearing on this rig needs attention; this turns
the snapshot at that moment into an `Observation` the investigation engine can
work on, so the same real recording also answers *what*. The machine record
comes from the dataset authors' page: the tested bearing's geometry
(`forecast.runs.XJTU_BEARING`), 25.6 kHz sampling, and the shaft speed in each
condition's name (35, 37.5 or 40 Hz).
"""

from __future__ import annotations

import re

from ..forecast.runs import XJTU_BEARING, XJTU_FS_HZ, Run
from ..models import MachineSpec, Observation

_HZ = re.compile(r"(\d+(?:\.\d+)?)Hz", re.IGNORECASE)


def rpm_of(condition: str) -> float:
    """`35Hz12kN` -> 2100 rpm: the condition names the shaft frequency."""
    m = _HZ.search(condition)
    if m is None:
        raise ValueError(f"no shaft frequency in condition {condition!r}")
    return float(m.group(1)) * 60.0


def machine(run: Run) -> MachineSpec:
    return MachineSpec(
        machine_id=run.run_id,
        name=f"XJTU-SY test rig ({run.condition})",
        bearing=XJTU_BEARING,
        nominal_rpm=rpm_of(run.condition),
        sample_rate_hz=XJTU_FS_HZ,
        notes="horizontal accelerometer; one tested bearing per run",
    )


def observation(run: Run, index: int) -> Observation:
    """Snapshot `index` of the run (horizontal channel), at the condition's speed."""
    return Observation(
        machine_id=run.run_id,
        waveform=run.load(index),
        sample_rate_hz=run.fs,
        rpm=rpm_of(run.condition),
        source=f"xjtu-sy:{run.run_id}/{run.files[index].name}",
    )
