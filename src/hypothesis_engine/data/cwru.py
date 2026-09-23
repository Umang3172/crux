"""Case Western Reserve University bearing data.

The rig cannot honestly fake a spalled race, so real bearing faults come from
CWRU recordings. Download the .mat files yourself and drop them in `data/cwru/`:

    https://engineering.case.edu/bearingdatacenter

Useful open mirrors and loaders, if you would rather not curate it by hand:

* https://github.com/Litchiware/cwru — downloads the .mat files for you
* https://github.com/srigas/CWRU_Bearing_NumPy — cleaned .npz version
* https://github.com/fonderxu/Bearing-fault-diagnosis-datasets — CWRU + Paderborn + JNU

We keep our own thin loader so nothing in the critical path depends on an
unmaintained package.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from ..models import SKF_6205_2RS_JEM, MachineSpec, Observation

DATA_DIR = Path(__file__).resolve().parents[3] / "data" / "cwru"

CWRU_DRIVE_END = MachineSpec(
    machine_id="cwru-de",
    name="CWRU test rig, drive end",
    bearing=SKF_6205_2RS_JEM,
    nominal_rpm=1797.0,
    sample_rate_hz=12_000.0,
    notes="2 hp Reliance Electric motor; drive-end accelerometer at 12 kHz",
)


def available() -> list[Path]:
    """The .mat files we can see right now."""
    if not DATA_DIR.exists():
        return []
    return sorted(DATA_DIR.glob("*.mat"))


def load_capture(path: str | Path, rpm: float | None = None) -> Observation:
    """Load one CWRU .mat file as an Observation.

    CWRU stores variables like `X097_DE_time` (drive end), `X097_FE_time` (fan
    end) and `X097RPM`. We take the drive-end channel and the stated speed.
    """
    from scipy.io import loadmat  # imported lazily: scipy is heavy

    path = Path(path)
    mat = loadmat(str(path))
    de_key = next((k for k in mat if k.endswith("_DE_time")), None)
    if de_key is None:
        raise ValueError(f"{path.name} has no drive-end channel")
    x = np.asarray(mat[de_key]).squeeze()

    if rpm is None:
        rpm_key = next((k for k in mat if k.upper().endswith("RPM")), None)
        rpm = float(np.asarray(mat[rpm_key]).squeeze()) if rpm_key else CWRU_DRIVE_END.nominal_rpm

    return Observation(
        machine_id=CWRU_DRIVE_END.machine_id,
        waveform=x,
        sample_rate_hz=CWRU_DRIVE_END.sample_rate_hz,
        rpm=float(rpm),
        source=f"cwru:{path.name}",
    )
