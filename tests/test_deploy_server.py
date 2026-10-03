"""The deployment entrypoint's presentation endpoints.

`deploy/server.py` adds routes the UI draws from. They decide nothing, but a
gauge that disagrees with the capture under investigation would be a lie on
screen, so the reading is checked against the same capture the engine sees.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from deploy.server import PREVIEW_POINTS, app  # noqa: E402

from hypothesis_engine.data.rig import BENCH_RIG, synthetic_capture  # noqa: E402
from hypothesis_engine.models import FaultKind  # noqa: E402

client = TestClient(app)


def test_capture_reports_the_same_reading_the_engine_diagnoses():
    body = client.post("/capture", json={"fault": "imbalance", "severity": 0.6, "seed": 7}).json()
    obs = synthetic_capture(FaultKind.IMBALANCE, BENCH_RIG, severity=0.6, seed=7)
    assert body["rpm"] == round(obs.rpm, 1)
    assert body["rms"] == round(float(np.sqrt(np.mean(obs.waveform**2))), 4)
    assert 0 < len(body["waveform"]) <= PREVIEW_POINTS


def test_a_faulty_machine_reads_above_the_healthy_baseline():
    faulty = client.post("/capture", json={"fault": "imbalance", "severity": 1.0}).json()
    assert faulty["rms"] > faulty["baseline_rms"]
