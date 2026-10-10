"""A live sensor's door into the engine: batches in, a normal marked, a case opened.

The batches are made the way the rig's firmware makes them: one second of raw
counts at 2 kHz with the sensor's own clock on each. The signal behind them is
synthetic; what is checked is the door, not the diagnosis of a real machine.
"""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from hypothesis_engine.api import app as api
from hypothesis_engine.data.rig import BENCH_RIG_ESP32, synthetic_capture
from hypothesis_engine.data.stream import (
    CAPTURE_S,
    KEEP_SECONDS,
    NORMAL_CAPTURES,
    NotEnoughSignal,
    Streams,
)
from hypothesis_engine.models import FaultKind

FS = BENCH_RIG_ESP32.sample_rate_hz
RIG = BENCH_RIG_ESP32.machine_id
SCALE = 0.000244  # g per count, as the firmware reports it
TOKEN = "let-the-rig-in"


def _signal(fault: FaultKind, seconds: float, seed: int = 3) -> np.ndarray:
    return synthetic_capture(fault, BENCH_RIG_ESP32, duration_s=seconds, seed=seed).waveform


def _batches(x: np.ndarray, start_ms: float = 0.0):
    """Cut a signal into the firmware's one-second posts of raw counts."""
    n = int(FS)
    for k in range(len(x) // n):
        yield {
            "machine_id": RIG,
            "token": TOKEN,
            "sample_rate_hz": FS,
            "started_at_ms": start_ms + 1000.0 * k,
            "scale_g_per_lsb": SCALE,
            "samples": np.round(x[k * n : (k + 1) * n] / SCALE).tolist(),
        }


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("RIG_INGEST_TOKEN", TOKEN)
    monkeypatch.setattr(api, "_LIVE", Streams({RIG: BENCH_RIG_ESP32}))
    return TestClient(api.app)


# ---------------------------------------------------------------- the stretch that is kept


def test_batches_that_follow_on_are_joined_and_a_gap_starts_again():
    streams = Streams({RIG: BENCH_RIG_ESP32})
    second = np.ones(int(FS))
    streams.add(RIG, FS, 0.0, second)
    assert streams.add(RIG, FS, 1000.0, second).seconds == pytest.approx(2.0)
    assert streams.add(RIG, FS, 2100.0, second).seconds == pytest.approx(3.0), (
        "a tenth late is fine"
    )
    # Half a second went missing: what came before is dropped, never bridged.
    assert streams.add(RIG, FS, 3600.0, second).seconds == pytest.approx(1.0)
    # The sensor restarted and its clock went back to zero.
    streams.add(RIG, FS, 4600.0, second)
    assert streams.add(RIG, FS, 0.0, second).seconds == pytest.approx(1.0)


def test_only_the_latest_minute_is_kept():
    streams = Streams({RIG: BENCH_RIG_ESP32})
    for k in range(int(KEEP_SECONDS) + 5):
        streams.add(RIG, FS, 1000.0 * k, np.full(int(FS), float(k)))
    stream = streams.get(RIG)
    assert stream.seconds == pytest.approx(KEEP_SECONDS)
    assert stream.samples[-1] == KEEP_SECONDS + 4 and stream.samples[0] == 5.0


def test_a_batch_at_another_rate_or_for_an_unknown_machine_is_refused():
    streams = Streams({RIG: BENCH_RIG_ESP32})
    with pytest.raises(ValueError, match="on file at 2000 Hz"):
        streams.add(RIG, 1000.0, 0.0, np.ones(1000))
    with pytest.raises(KeyError, match="not on file"):
        streams.add("pump-9", FS, 0.0, np.ones(2000))
    with pytest.raises(ValueError, match="finite"):
        streams.add(RIG, FS, 0.0, np.array([1.0, np.nan]))


def test_a_capture_is_the_latest_signal_and_needs_enough_of_it():
    streams = Streams({RIG: BENCH_RIG_ESP32})
    streams.add(RIG, FS, 0.0, np.arange(int(FS), dtype=float))
    with pytest.raises(NotEnoughSignal, match="1.0 s of unbroken signal"):
        streams.capture(RIG)
    streams.add(RIG, FS, 1000.0, np.arange(int(FS), dtype=float) + FS)
    latest = streams.capture(RIG)
    assert len(latest.waveform) == int(CAPTURE_S * FS) and latest.sample_rate_hz == FS
    assert latest.waveform.mean() == pytest.approx(0.0, abs=1e-9)
    assert latest.waveform[-1] - latest.waveform[0] == pytest.approx(CAPTURE_S * FS - 1)


# ---------------------------------------------------------------- the door


def test_ingestion_is_off_until_the_server_is_given_a_token(monkeypatch):
    monkeypatch.delenv("RIG_INGEST_TOKEN", raising=False)
    monkeypatch.setattr(api, "_LIVE", Streams({RIG: BENCH_RIG_ESP32}))
    c = TestClient(api.app)
    batch = next(_batches(_signal(FaultKind.HEALTHY, 1.0)))
    assert c.post("/ingest", json=batch).status_code == 503
    assert c.post(f"/ingest/{RIG}/investigate", json={"token": TOKEN}).status_code == 503
    assert c.get(f"/ingest/{RIG}").json()["seconds"] == 0.0, "reading the status needs no token"


def test_a_wrong_token_or_an_unknown_machine_gets_nothing_in(client):
    batch = next(_batches(_signal(FaultKind.HEALTHY, 1.0)))
    assert client.post("/ingest", json={**batch, "token": "guess"}).status_code == 401
    assert client.post("/ingest", json={**batch, "machine_id": "pump-9"}).status_code == 404
    assert client.post("/ingest", json={**batch, "sample_rate_hz": 1000}).status_code == 422
    assert client.get(f"/ingest/{RIG}").json()["batches"] == 0


def test_from_the_firmwares_posts_to_a_case_scored_against_the_rigs_own_normal(client):
    healthy = _signal(FaultKind.HEALTHY, 12.0, seed=5)
    for batch in _batches(healthy):
        status = client.post("/ingest", json=batch).json()
    assert status["seconds"] == pytest.approx(12.0) and status["ready"]

    assert (
        client.post(f"/ingest/{RIG}/investigate", json={"token": TOKEN}).json()["own_normal"]
        is None
    )
    marked = client.post(f"/ingest/{RIG}/normal", json={"token": TOKEN}).json()
    assert marked["normal_captures"] == NORMAL_CAPTURES

    # The rotor is then put out of balance. The posts carry on from the same clock.
    for batch in _batches(_signal(FaultKind.IMBALANCE, 4.0, seed=9), start_ms=12_000.0):
        client.post("/ingest", json=batch)
    case = client.post(f"/ingest/{RIG}/investigate", json={"token": TOKEN}).json()
    assert case["own_normal"]["captures"] == NORMAL_CAPTURES
    assert case["hypotheses"][0]["kind"] == "imbalance"
    assert case["machine"]["name"] == BENCH_RIG_ESP32.name
    assert any("envelope not available" in e["statement"] for e in case["ledger"])
    # It is a case like any other: it can be read back by its id.
    assert client.get(f"/investigations/{case['id']}").json()["id"] == case["id"]


def test_a_normal_or_a_case_needs_two_seconds_of_unbroken_signal(client):
    for batch in _batches(_signal(FaultKind.HEALTHY, 1.0)):
        client.post("/ingest", json=batch)
    assert client.post(f"/ingest/{RIG}/normal", json={"token": TOKEN}).status_code == 409
    r = client.post(f"/ingest/{RIG}/investigate", json={"token": TOKEN})
    assert r.status_code == 409 and "1.0 s of unbroken signal" in r.json()["detail"]
