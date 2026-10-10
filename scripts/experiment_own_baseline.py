#!/usr/bin/env python3
"""Experiment: virtual experiments built on the machine's own healthy recording.

    uv run python scripts/experiment_own_baseline.py

The engine simulates each suspect on a textbook machine (`predicted_signature`
with its baseline tones) and compares that with the real capture. Real rigs have
their own normal spectrum, so on XJTU-SY the textbook healthy machine loses to
misalignment or imbalance on most bearings. Here each suspect is simulated as
the bearing's own healthy recording plus only that fault's components, scaled to
the energy the bearing has gained since it was healthy; "healthy" is another of
its own healthy recordings. Physics and comparison are the engine's own
(`synthesize`, `spectral_correlation`). Nothing here moves a belief: it prints
correlations, to judge whether the engine should work this way.

Needs the XJTU-SY files and `scripts/forecast.py table --dataset xjtu`.
"""

from __future__ import annotations

from dataclasses import replace

import numpy as np

from hypothesis_engine.data import xjtu
from hypothesis_engine.forecast import health, runs
from hypothesis_engine.forecast.models import onset_of
from hypothesis_engine.models import FaultKind, MachineSpec
from hypothesis_engine.physics.compare import spectral_correlation
from hypothesis_engine.physics.signatures import DEFAULT_HYPOTHESES, Signature, predicted_signature
from hypothesis_engine.physics.synth import synthesize

TABLE = runs.DATA_ROOT / "forecast" / "health_xjtu.csv"
IN_CATALOGUE = {"outer race": "outer_race", "inner race": "inner_race"}
SEED = 7 + 101  # the engine's simulation seed


def fault_only(kind: FaultKind, machine: MachineSpec, rpm: float) -> Signature:
    """The suspect's signature without the textbook machine's running tones or noise."""
    sig = predicted_signature(kind, machine, rpm)
    running = {t.label for t in predicted_signature(FaultKind.HEALTHY, machine, rpm).tones}
    return replace(sig, tones=tuple(t for t in sig.tones if t.label not in running), noise=0.0)


def correlations(run: runs.Run, reading: int, healthy: int, other_healthy: int) -> dict[str, float]:
    machine = xjtu.machine(run)
    real, base = run.load(reading), run.load(healthy)
    n = len(real)
    gained = max(float(np.mean(real**2) - np.mean(base**2)), 1e-12)
    out = {}
    for kind in DEFAULT_HYPOTHESES:
        if kind is FaultKind.HEALTHY:
            sim = run.load(other_healthy)
        else:
            f = synthesize(
                fault_only(kind, machine, machine.nominal_rpm),
                sample_rate_hz=run.fs,
                duration_s=n / run.fs,
                seed=SEED,
            )[:n]
            sim = base + f * np.sqrt(gained / max(float(np.mean(f**2)), 1e-12))
        out[kind.value] = spectral_correlation(real, sim, run.fs)
    return out


def main() -> int:
    tables = {h.run_id: h for h in (health.trim_stopped(x) for x in health.load(TABLE))}
    right = total = calm = 0
    found = runs.xjtu_runs()
    for run in found:
        h = tables[run.run_id]
        control = correlations(run, 5, 1, 2)  # an early, healthy minute
        control_lead = max(control, key=control.get)
        calm += control_lead == "healthy"
        o = onset_of(h)
        if o is None:
            print(f"{run.run_id:28s} no alarm | healthy minute led by {control_lead}")
            continue
        scores = correlations(run, int(round(h.t[o])), 1, 2)
        ranked = sorted(scores.items(), key=lambda kv: -kv[1])
        truth = IN_CATALOGUE.get(run.failure_mode)
        if truth:
            total += 1
            right += ranked[0][0] == truth
        top = ", ".join(f"{k} {v:.2f}" for k, v in ranked[:3])
        print(
            f"{run.run_id:28s} {run.failure_mode[:24]:24s} -> {top} | healthy minute led by {control_lead}"
        )
    print(
        f"leader right on {right}/{total} diagnosable bearings; a healthy minute led by healthy on {calm}/{len(found)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
