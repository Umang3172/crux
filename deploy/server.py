"""The ASGI app the container runs: one origin, one link to give a judge.

`api/app.py` is the product's HTTP surface and stays that way. Two things the
deployment needs that it does not provide yet are added here, both additive and
both deletable the moment the API grows them:

1. **The built UI**, mounted after every API route so nothing is shadowed. A
   judge should land on the investigation, not on a JSON document.
2. **`POST /spectrum`**, the measured-against-simulated traces behind the plot.
   It runs the same deterministic functions the investigation runs; it decides
   nothing and no belief depends on it.

Run it with `uvicorn deploy.server:app`. `hypengine serve` still serves the API
alone, and the UI degrades to a note when `/spectrum` is not there.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Literal

import numpy as np
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from hypothesis_engine.api.app import app
from hypothesis_engine.data.rig import BENCH_RIG, synthetic_capture
from hypothesis_engine.models import FaultKind
from hypothesis_engine.physics.signatures import predicted_signature
from hypothesis_engine.physics.synth import synthesize
from hypothesis_engine.signals.features import envelope_spectrum, magnitude_spectrum

#: `investigation.engine` synthesises each hypothesis at `self.seed + 101`. The
#: plot has to show the waveform the correlation was actually computed from, so
#: the offset is repeated rather than approximated. If engine.py changes it,
#: change it here too — a mismatched picture is worse than no picture.
SIM_SEED = 7 + 101

#: Bin width for the plotted spectra, matching `physics.compare`.
BIN_HZ = 2.0

_REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_DIST = Path(os.getenv("WEB_DIST", _REPO_ROOT / "web" / "dist"))


class SpectrumRequest(BaseModel):
    fault: FaultKind = Field(default=FaultKind.OUTER_RACE, description="Fault induced on the rig.")
    hypothesis: FaultKind = Field(
        default=FaultKind.OUTER_RACE, description="Which hypothesis to simulate for comparison."
    )
    band: Literal["raw", "envelope"] = "raw"
    rpm: float | None = None
    severity: float = 1.0
    seed: int = 1234


def _peak_hold(freqs: np.ndarray, mag: np.ndarray, f_max: float) -> tuple[list[float], list[float]]:
    """Bin a spectrum for drawing: peak-hold, then log-compress to its own max.

    This mirrors `physics.compare._binned_log` so the picture agrees with the
    correlation beside it. It is presentation only — nothing here moves a belief.
    """
    keep = freqs <= f_max
    freqs, mag = freqs[keep], mag[keep]
    edges = np.arange(0.0, f_max + BIN_HZ, BIN_HZ)
    index = np.digitize(freqs, edges) - 1
    binned = np.zeros(len(edges) - 1)
    for b in range(len(binned)):
        selected = index == b
        if np.any(selected):
            binned[b] = mag[selected].max()
    compressed = np.log1p(binned / (binned.max() + 1e-12))
    centres = edges[:-1] + BIN_HZ / 2.0
    return [round(float(f), 2) for f in centres], [round(float(v), 5) for v in compressed]


if "/spectrum" not in {getattr(route, "path", None) for route in app.routes}:

    @app.post("/spectrum")
    def spectrum(req: SpectrumRequest) -> dict[str, Any]:
        """The virtual experiment, drawn: the real capture against one hypothesis."""
        observation = synthetic_capture(
            req.fault, BENCH_RIG, rpm=req.rpm, severity=req.severity, seed=req.seed
        )
        fs = observation.sample_rate_hz
        signature = predicted_signature(req.hypothesis, BENCH_RIG, observation.rpm)
        simulated = synthesize(
            signature,
            sample_rate_hz=fs,
            duration_s=min(2.0, observation.duration_s),
            seed=SIM_SEED,
        )

        transform = magnitude_spectrum if req.band == "raw" else envelope_spectrum
        f_max = 500.0 if req.band == "raw" else 400.0
        freqs, real_mag = transform(observation.waveform, fs)
        _, sim_mag = transform(simulated, fs)

        centres, real_bins = _peak_hold(freqs, real_mag, f_max)
        _, sim_bins = _peak_hold(freqs, sim_mag, f_max)
        return {
            "band": req.band,
            "hypothesis": req.hypothesis.value,
            "f_max_hz": f_max,
            "freq_hz": centres,
            "real": real_bins,
            "simulated": sim_bins,
        }


class CaptureRequest(BaseModel):
    fault: FaultKind = Field(default=FaultKind.OUTER_RACE, description="Fault induced on the rig.")
    rpm: float | None = None
    severity: float = 1.0
    seed: int = 1234


#: Points in the waveform preview. Enough to draw a trace that looks like vibration
#: on a phone or a projector; the full capture never leaves the server.
PREVIEW_POINTS = 600

#: The healthy baseline is rendered at its own fixed seed, so the "times normal"
#: figure compares against one reference machine, not against a moving target.
BASELINE_SEED = 4242


if "/capture" not in {getattr(route, "path", None) for route in app.routes}:

    @app.post("/capture")
    def capture(req: CaptureRequest) -> dict[str, Any]:
        """The sensor reading behind a case, for the gauges and the live trace.

        The same capture `/investigations` and `/replay` diagnose, reduced to what
        a person reads off a handheld meter: vibration level against a healthy
        machine of the same type, housing temperature, speed, and a short slice of
        the waveform. Presentation only; nothing here moves a belief.
        """
        observation = synthetic_capture(
            req.fault, BENCH_RIG, rpm=req.rpm, severity=req.severity, seed=req.seed
        )
        baseline = synthetic_capture(FaultKind.HEALTHY, BENCH_RIG, rpm=req.rpm, seed=BASELINE_SEED)
        x = np.asarray(observation.waveform, dtype=float)
        rms = float(np.sqrt(np.mean(x**2)))
        baseline_rms = float(np.sqrt(np.mean(np.asarray(baseline.waveform) ** 2)))
        # A quarter of a second shows several shaft turns at ~30 Hz.
        window = x[: int(0.25 * observation.sample_rate_hz)]
        step = max(1, len(window) // PREVIEW_POINTS)
        preview = window[::step][:PREVIEW_POINTS]
        return {
            "rpm": round(observation.rpm, 1),
            "temperature_c": None
            if observation.temperature_c is None
            else round(observation.temperature_c, 1),
            "rms": round(rms, 4),
            "baseline_rms": round(baseline_rms, 4),
            "sample_rate_hz": observation.sample_rate_hz / step,
            "waveform": [round(float(v), 4) for v in preview],
            "source": observation.source,
        }


# Last, so every API route above wins the match. `html=True` serves index.html
# for the bare origin. When the bundle is absent (a plain `uvicorn` run before
# `npm run build`) the API simply serves itself.
if (WEB_DIST / "index.html").is_file():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
