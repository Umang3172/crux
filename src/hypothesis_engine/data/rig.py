"""Synthetic rig captures.

Used for tests, for the replay mode judges can run without hardware, and as the
stand-in until the ESP32 rig streams real data (see firmware/).

Important: the ground-truth capture is generated with a *different* random seed
and a little extra noise compared with the simulator the investigator runs, so a
passing test means the shapes match, not that we compared a signal with itself.
"""

from __future__ import annotations

from typing import Literal, get_args

import numpy as np

from ..models import SKF_6205_2RS_JEM, FaultKind, MachineSpec, Observation
from ..physics.frequencies import fault_frequencies, shaft_hz
from ..physics.signatures import ImpactTrain, Signature, predicted_signature
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


#: Faults the catalogue does not list, for showing what the investigator does
#: when the list is missing a cause. The engine is never told about them.
OffCatalogue = Literal["rolling_element", "unlisted_impact"]
OFF_CATALOGUE: tuple[str, ...] = get_args(OffCatalogue)

#: A rate for `unlisted_impact` chosen to sit on nothing this machine predicts:
#: on the 6205 the nearest bearing line is 2x BPFO at 7.17x (6 % away) and the
#: nearest shaft harmonics are 7x and 8x, so no catalogue hypothesis explains it
#: and no bearing frequency matches it. A scenario choice, not a physical constant.
UNLISTED_IMPACT_ORDER = 7.6


def off_catalogue_signature(
    name: str, machine: MachineSpec, rpm: float, severity: float = 1.0
) -> Signature:
    """A normal machine plus impacts no catalogue hypothesis predicts.

    The impacts ring the same resonance, at the same strength per severity, as
    the catalogue's bearing faults, so only their rate is new.
    """
    healthy = predicted_signature(FaultKind.HEALTHY, machine, rpm)
    if name == "rolling_element":
        # A spall on a rolling element strikes the outer and the inner race once
        # each per turn of the element, so it shows at twice the ball-spin
        # frequency, modulated as the cage carries it in and out of the load zone.
        ff = fault_frequencies(machine.bearing, rpm)
        train = ImpactTrain(ff.bsf_2x, 1.00 * severity, modulation_hz=ff.ftf, label="2xBSF impacts")
        what = "A spalled rolling element: impacts at twice the ball-spin frequency."
    elif name == "unlisted_impact":
        rate = UNLISTED_IMPACT_ORDER * shaft_hz(rpm)
        train = ImpactTrain(rate, 1.00 * severity, label="unlisted impacts")
        what = f"Impacts at {UNLISTED_IMPACT_ORDER:g}x shaft speed, on no bearing frequency."
    else:
        raise ValueError(f"unknown scenario {name!r}; off-catalogue ones are {OFF_CATALOGUE}")
    return Signature(None, healthy.tones, (train,), noise=healthy.noise, description=what)


def scenario(name: str) -> FaultKind | str:
    """A fault to induce on the rig, by name: a catalogue fault or an off-catalogue one."""
    if name in {k.value for k in FaultKind}:
        return FaultKind(name)
    if name in OFF_CATALOGUE:
        return name
    raise ValueError(
        f"unknown fault {name!r}: one of {[k.value for k in FaultKind] + list(OFF_CATALOGUE)}"
    )


def synthetic_capture(
    fault: FaultKind | str,
    machine: MachineSpec = BENCH_RIG,
    rpm: float | None = None,
    severity: float = 1.0,
    duration_s: float = 2.0,
    seed: int = 1234,
    extra_noise: float = 0.05,
) -> Observation:
    """A capture that behaves like the rig with `fault` induced: a catalogue
    fault, or one of `OFF_CATALOGUE` by name."""
    rpm = rpm or machine.nominal_rpm
    fault = scenario(fault) if isinstance(fault, str) else fault
    if isinstance(fault, FaultKind):
        sig = predicted_signature(fault, machine, rpm, severity=severity)
        # A milder fault heats the housing proportionally less: the table is the
        # rise at full strength, a healthy machine's the rise at none.
        rest = TEMPERATURE_RISE[FaultKind.HEALTHY]
        rise: float | None = rest + (TEMPERATURE_RISE[fault] - rest) * min(severity, 1.0)
    else:
        sig = off_catalogue_signature(fault, machine, rpm, severity=severity)
        rise = None  # no rig figure for these, so no temperature is reported
    x = synthesize(sig, machine.sample_rate_hz, duration_s, seed=seed)
    rng = np.random.default_rng(seed + 1)
    x = x + rng.normal(0.0, extra_noise, len(x))
    seen_rpm = rpm + float(rng.normal(0, 1.5))
    temperature_jitter = float(rng.normal(0, 1.0))
    return Observation(
        machine_id=machine.machine_id,
        waveform=x,
        sample_rate_hz=machine.sample_rate_hz,
        rpm=seen_rpm,
        temperature_c=None if rise is None else 20.0 + rise + temperature_jitter,
        source="synthetic",
    )


def rig_oracle(
    fault: FaultKind | str,
    machine: MachineSpec = BENCH_RIG,
    seed: int = 99,
    severity: float = 1.0,
    extra_noise: float = 0.05,
    rpm: float | None = None,
):
    """Answer the agent's measurement requests from the (synthetic) rig.

    Stands in for a coached technician: same interface, no person needed. A
    capture test is answered by a new capture of the same machine in the same
    state (`severity`, `extra_noise` and `rpm` as the case was opened with, a
    different seed), as long as the test asks for, and the feature is read from
    it the way it would be from a real one. The answer never comes from a clean
    or full-strength copy of the fault.
    """
    from ..investigation.catalog import BY_ID
    from ..physics.likelihood import capture_features

    def answer(test_id: str) -> float | None:
        test = BY_ID[test_id]
        if test.capture_s is not None:
            obs = synthetic_capture(
                fault,
                machine,
                rpm=rpm,
                severity=severity,
                duration_s=test.capture_s,
                seed=seed,
                extra_noise=extra_noise,
            )
            found = capture_features(obs.waveform, obs.sample_rate_hz, obs.rpm, machine)
            return found.get(test.feature)
        if test.feature == "temp_rise_c":
            obs = synthetic_capture(fault, machine, seed=seed, severity=severity)
            return float(obs.temperature_c - 20.0) if obs.temperature_c else None
        if test.feature == "speed_sensitivity":
            # A coast-down would give the speed exponent; the rig fixture fakes it,
            # by the amount of imbalance the machine was given.
            extra = 0.9 if fault == FaultKind.IMBALANCE else 0.0
            return 1.0 + extra * min(severity, 1.0)
        return None

    return answer
