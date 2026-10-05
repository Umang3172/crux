"""Synthetic rig captures.

Used for tests, for the replay mode judges can run without hardware, and as the
stand-in until the ESP32 rig streams real data (see firmware/).

Important: the ground-truth capture is generated with a *different* random seed
and a little extra noise compared with the simulator the investigator runs, so a
passing test means the shapes match, not that we compared a signal with itself.
"""

from __future__ import annotations

import numpy as np

from ..models import SKF_6205_2RS_JEM, FaultKind, MachineSpec, Observation
from ..physics.signatures import predicted_signature
from ..physics.synth import synthesize

#: The synthetic stand-in the demo and the tests run on, at the CWRU rate so the
#: bearing resonance band is visible. It is not the hardware: see BENCH_RIG_ESP32.
BENCH_RIG = MachineSpec(
    machine_id="rig-01",
    name="MechNova bench rig",
    bearing=SKF_6205_2RS_JEM,
    nominal_rpm=1798.0,
    sample_rate_hz=12_000.0,
    blade_count=3,
    notes="Synthetic captures at 12 kHz; the physical rig is BENCH_RIG_ESP32",
)

#: The physical rig as the firmware actually samples it (firmware/esp32_rig:
#: 2 kHz, MPU6050 low-pass at 184 Hz). Shaft orders are visible; the 1.5–5 kHz
#: bearing resonance band is not, so envelope evidence is reported as unavailable.
BENCH_RIG_ESP32 = MachineSpec(
    machine_id="rig-01",
    name="MechNova bench rig (ESP32 + MPU6050)",
    bearing=SKF_6205_2RS_JEM,
    nominal_rpm=1798.0,
    sample_rate_hz=2_000.0,
    blade_count=3,
    notes="ESP32 + MPU6050 on a small motor; see docs/HARDWARE.md",
)

TEMPERATURE_RISE = {
    FaultKind.HEALTHY: 1.0,
    FaultKind.IMBALANCE: 2.5,
    FaultKind.MISALIGNMENT: 6.5,
    FaultKind.LOOSENESS: 3.5,
    FaultKind.OUTER_RACE: 12.5,
    FaultKind.INNER_RACE: 13.5,
}


def synthetic_capture(
    fault: FaultKind,
    machine: MachineSpec = BENCH_RIG,
    rpm: float | None = None,
    severity: float = 1.0,
    duration_s: float = 2.0,
    seed: int = 1234,
    extra_noise: float = 0.05,
) -> Observation:
    """A capture that behaves like the rig with `fault` induced."""
    rpm = rpm or machine.nominal_rpm
    sig = predicted_signature(fault, machine, rpm, severity=severity)
    x = synthesize(sig, machine.sample_rate_hz, duration_s, seed=seed)
    rng = np.random.default_rng(seed + 1)
    x = x + rng.normal(0.0, extra_noise, len(x))
    return Observation(
        machine_id=machine.machine_id,
        waveform=x,
        sample_rate_hz=machine.sample_rate_hz,
        rpm=rpm + float(rng.normal(0, 1.5)),
        temperature_c=20.0 + TEMPERATURE_RISE[fault] + float(rng.normal(0, 1.0)),
        source="synthetic",
    )


def rig_oracle(fault: FaultKind, machine: MachineSpec = BENCH_RIG, seed: int = 99):
    """Answer the agent's measurement requests from the (synthetic) rig.

    Stands in for a coached technician: same interface, no person needed.
    """
    from ..investigation.catalog import BY_ID
    from ..signals import features as feat

    def answer(test_id: str) -> float | None:
        test = BY_ID[test_id]
        obs = synthetic_capture(fault, machine, seed=seed, duration_s=2.0)
        ev = feat.extract(obs, machine)
        if test.feature == "ratio_2x_1x":
            return ev.ratio_2x_1x()
        if test.feature == "env_contrast":
            return ev.env_contrast()
        if test.feature == "env_bpfo":
            return ev.env_bpfo
        if test.feature == "env_bpfi":
            return ev.env_bpfi
        if test.feature == "amp_half_x":
            return ev.amp_half_x
        if test.feature == "temp_rise_c":
            return float(obs.temperature_c - 20.0) if obs.temperature_c else None
        if test.feature == "speed_sensitivity":
            # A coast-down would give the speed exponent; the rig fixture fakes it.
            return {FaultKind.IMBALANCE: 1.9}.get(fault, 1.0)
        return None

    return answer
