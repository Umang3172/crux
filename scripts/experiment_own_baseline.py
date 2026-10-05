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

from dataclasses import replace

import numpy as np

from hypothesis_engine.data import xjtu
from hypothesis_engine.forecast import health, runs
from hypothesis_engine.forecast.models import onset_of
from hypothesis_engine.models import FaultKind
from hypothesis_engine.physics.compare import spectral_correlation
from hypothesis_engine.physics.signatures import DEFAULT_HYPOTHESES, predicted_signature
from hypothesis_engine.physics.synth import synthesize


def fault_only(kind, m, rpm):
    sig = predicted_signature(kind, m, rpm)
    base_labels = {t.label for t in predicted_signature(FaultKind.HEALTHY, m, rpm).tones}
    return replace(sig, tones=tuple(t for t in sig.tones if t.label not in base_labels), noise=0.0)


def score(run, real_i, base_i, base2_i):
    m = xjtu.machine(run)
    rpm = m.nominal_rpm
    fs = run.fs
    real, base, base2 = run.load(real_i), run.load(base_i), run.load(base2_i)
    n = len(real)
    dur = n / fs
    added = max(np.mean(real**2) - np.mean(base**2), 1e-12)
    out = {}
    for k in DEFAULT_HYPOTHESES:
        if k is FaultKind.HEALTHY:
            sim = base2
        else:
            f = synthesize(fault_only(k, m, rpm), sample_rate_hz=fs, duration_s=dur, seed=108)[:n]
            f = f * np.sqrt(added / max(np.mean(f**2), 1e-12))
            sim = base + f
        out[k.value] = spectral_correlation(real, sim, fs)
    return out


tables = {
    h.run_id: h
    for h in (
        health.trim_stopped(x) for x in health.load(runs.DATA_ROOT / "forecast" / "health_xjtu.csv")
    )
}
truth_map = {"outer race": "outer_race", "inner race": "inner_race"}
right = total = 0
healthy_ok = 0
for run in runs.xjtu_runs():
    h = tables[run.run_id]
    o = onset_of(h)
    ctrl = score(run, 5, 1, 2)
    lead_c = max(ctrl, key=ctrl.get)
    healthy_ok += lead_c == "healthy"
    if o is None:
        print(f"{run.run_id:28s} no alarm | control leader {lead_c}")
        continue
    s = score(run, int(round(h.t[o])), 1, 2)
    ranked = sorted(s.items(), key=lambda kv: -kv[1])
    lead = ranked[0][0]
    t = truth_map.get(run.failure_mode)
    if t:
        total += 1
        right += lead == t
    print(
        f"{run.run_id:28s} truth={run.failure_mode[:24]:24s} -> "
        + ", ".join(f"{k} {v:.2f}" for k, v in ranked[:3])
        + f" | control leader {lead_c}"
    )
print(
    f"leader right on {right}/{total} diagnosable bearings; healthy control led by 'healthy' on {healthy_ok}/15"
)
