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
from hypothesis_engine.investigation.engine import PICTURE_SEED_OFFSET
from hypothesis_engine.models import FaultKind
from hypothesis_engine.physics.signatures import predicted_signature
from hypothesis_engine.physics.synth import synthesize
from hypothesis_engine.signals.features import envelope_spectrum, magnitude_spectrum

#: The engine draws its picture of each hypothesis from one simulation at
#: `seed + PICTURE_SEED_OFFSET` (the investigation's default seed is 7). The plot
#: shows that same waveform, so the correlation beside it matches. Beliefs come
#: from the simulated likelihood, not from this picture (ADR-0008).
SIM_SEED = 7 + PICTURE_SEED_OFFSET

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


# Last, so every API route above wins the match. `html=True` serves index.html
# for the bare origin. When the bundle is absent (a plain `uvicorn` run before
# `npm run build`) the API simply serves itself.
if (WEB_DIST / "index.html").is_file():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
