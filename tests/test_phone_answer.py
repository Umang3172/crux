"""A phone scan answering the check an investigation asked for.

Synthetic signals, so these pin the conversion, the uncertainty and every
refusal, not how well a real phone hears or sees a real machine.
"""

from __future__ import annotations

import math
from dataclasses import asdict

import numpy as np
import pytest
from fastapi.testclient import TestClient

from hypothesis_engine.api.app import _INVESTIGATIONS, app, open_request
from hypothesis_engine.data.rig import BENCH_RIG, synthetic_capture
from hypothesis_engine.investigation.engine import Investigation
from hypothesis_engine.lens import answer
from hypothesis_engine.lens import experiments as ex
from hypothesis_engine.lens import scan as scans
from hypothesis_engine.models import FaultKind
from hypothesis_engine.physics.signatures import predicted_signature
from hypothesis_engine.physics.synth import synthesize

RPM = 1800.0
FS_AUDIO = 48_000.0


def _analysis(fps=240.0, rpm=RPM, amps=None, floors=None, clear=True):
    """An analysed scan's shaft lines, as `lens.scan.analyse` stores them."""
    amps = amps or {0.5: 0.4, 1.0: 10.0, 2.0: 5.0}
    floors = floors or {}
    fr = rpm / 60.0
    lines = [
        asdict(
            ex.Line(
                order=o,
                true_hz=o * fr,
                seen_hz=ex.seen_at(o * fr, fps),
                amp=amps.get(o, 0.1),
                clear=clear,
                floor=floors.get(o, 0.2),
            )
        )
        for o in ex.ORDERS
    ]
    return {"fps": fps, "rpm": rpm, "lines": lines}


def _sound(kind: FaultKind, seconds=8.0, rpm=RPM, seed=3) -> np.ndarray:
    return synthesize(predicted_signature(kind, BENCH_RIG, rpm), FS_AUDIO, seconds, seed)


# ------------------------------------------------------------------- camera


def test_camera_ratio_is_converted_from_displacement_to_acceleration():
    r = answer.camera_reading("vib_10s", _analysis(), RPM)
    # 5 / 10 in displacement; an accelerometer sees 2x four times stronger.
    assert r.value == pytest.approx(4 * 0.5)
    assert r.sensor == "camera"
    assert 0 < r.uncertainty < r.value


def test_half_order_reads_a_quarter_as_strong_in_acceleration():
    r = answer.camera_reading("half_order", _analysis(), RPM)
    assert r.value == pytest.approx(0.25 * 0.4 / 10.0)


def test_camera_uncertainty_grows_with_the_noise_around_the_lines():
    quiet = answer.camera_reading("vib_10s", _analysis(floors={1.0: 0.1, 2.0: 0.1}), RPM)
    noisy = answer.camera_reading("vib_10s", _analysis(floors={1.0: 1.0, 2.0: 1.0}), RPM)
    assert noisy.uncertainty > quiet.uncertainty


def test_the_shutter_adds_more_doubt_the_closer_a_line_sits_to_half_the_frame_rate():
    fast = answer.camera_reading("vib_10s", _analysis(fps=1000.0), RPM)
    near = answer.camera_reading("vib_10s", _analysis(fps=130.0), RPM)
    assert near.uncertainty > fast.uncertainty


def test_a_line_the_camera_folds_back_is_refused():
    with pytest.raises(answer.CannotAnswer, match="Slo-mo"):
        answer.camera_reading("vib_10s", _analysis(fps=60.0), RPM)


def test_a_line_crowded_by_another_is_refused():
    with pytest.raises(answer.CannotAnswer, match="on its own"):
        answer.camera_reading("vib_10s", _analysis(clear=False), RPM)


def test_a_weak_1x_is_refused_because_everything_is_divided_by_it():
    with pytest.raises(answer.CannotAnswer, match="above the noise"):
        answer.camera_reading("vib_10s", _analysis(amps={1.0: 0.5, 2.0: 0.4}), RPM)


def test_a_scan_analysed_before_noise_was_recorded_must_be_analysed_again():
    old = _analysis()
    for line in old["lines"]:
        line.pop("floor")
    with pytest.raises(answer.CannotAnswer, match="analyse it again"):
        answer.camera_reading("vib_10s", old, RPM)


def test_a_clip_at_another_speed_does_not_speak_for_the_case():
    with pytest.raises(answer.CannotAnswer, match="rpm"):
        answer.camera_reading("vib_10s", _analysis(rpm=1500.0), RPM)


def test_lines_record_the_noise_floor_beside_each_line():
    fps, fr = 240.0, RPM / 60.0
    t = np.arange(int(fps * 8)) / fps
    rng = np.random.default_rng(0)
    x = np.sin(2 * np.pi * fr * t) + 0.5 * np.sin(2 * np.pi * 2 * fr * t)
    x = x + rng.normal(0, 0.02, len(t))
    found = {ln.order: ln for ln in ex.lines(x, fps, RPM)}
    assert found[1.0].floor > 0
    assert found[1.0].amp > 50 * found[1.0].floor


# -------------------------------------------------------------------- sound


@pytest.mark.parametrize(("kind", "sign"), [(FaultKind.OUTER_RACE, 1), (FaultKind.INNER_RACE, -1)])
def test_sound_points_the_envelope_at_the_damaged_race(kind, sign):
    r = answer.sound_reading(_sound(kind), FS_AUDIO, BENCH_RIG, RPM, RPM)
    assert r.test_id == "envelope" and r.sensor == "microphone"
    assert sign * r.value > 1.0
    assert 0 < r.uncertainty < 0.5


def test_sound_of_a_healthy_bearing_reads_near_zero():
    r = answer.sound_reading(_sound(FaultKind.HEALTHY), FS_AUDIO, BENCH_RIG, RPM, RPM)
    assert abs(r.value) < 0.3


def test_sound_too_short_to_judge_its_spread_is_refused():
    with pytest.raises(answer.CannotAnswer, match="at least"):
        answer.sound_reading(_sound(FaultKind.OUTER_RACE, 4.0), FS_AUDIO, BENCH_RIG, RPM, RPM)


def test_a_silent_video_is_refused():
    with pytest.raises(answer.CannotAnswer, match="no sound"):
        answer.sound_reading(None, 0.0, BENCH_RIG, RPM, RPM)


def test_sound_sampled_too_slowly_for_the_envelope_band_is_refused():
    x = _sound(FaultKind.OUTER_RACE)[::8]
    with pytest.raises(answer.CannotAnswer, match="too slow"):
        answer.sound_reading(x, FS_AUDIO / 8, BENCH_RIG, RPM, RPM)


@pytest.mark.parametrize("test_id", ["temperature", "coast_down", "no_such_check"])
def test_checks_a_phone_cannot_measure_are_refused_with_a_reason(test_id):
    assert answer.refusal(test_id)


@pytest.mark.parametrize("test_id", ["envelope", "vib_10s", "half_order"])
def test_checks_a_phone_might_answer_are_not_refused_up_front(test_id):
    assert answer.refusal(test_id) is None


# ------------------------------------------------------------------- engine


def _waiting_case() -> Investigation:
    inv = Investigation(
        BENCH_RIG,
        synthetic_capture(FaultKind.IMBALANCE, BENCH_RIG, severity=0.15, seed=2, extra_noise=0.2),
    )
    inv.observe()
    inv.run_virtual_experiments()
    inv.advance()
    assert open_request(inv.state) == "envelope", "the fixture case should ask for the envelope"
    return inv


def test_an_uncertain_reading_moves_the_beliefs_less():
    sure, unsure = _waiting_case(), _waiting_case()
    before = sure.state.beliefs()["outer_race"]
    sure.apply_outcome("envelope", 2.0, collected_by="phone video")
    unsure.apply_outcome("envelope", 2.0, collected_by="phone video", uncertainty=2.0)
    moved_sure = sure.state.beliefs()["outer_race"] - before
    moved_unsure = unsure.state.beliefs()["outer_race"] - before
    assert moved_sure > moved_unsure > 0


@pytest.mark.parametrize("bad", [-0.1, math.inf, math.nan])
def test_an_impossible_uncertainty_is_refused(bad):
    with pytest.raises(ValueError, match="uncertainty"):
        _waiting_case().apply_outcome("envelope", 2.0, uncertainty=bad)


# ---------------------------------------------------------------------- API


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(scans, "LENS_DIR", tmp_path)
    return TestClient(app)


def _scan_on_file(analysis: dict | None, scan_id: str = "S-phone01") -> str:
    folder = scans.LENS_DIR / scan_id
    folder.mkdir(parents=True)
    scans.save(
        scans.Scan(
            id=scan_id,
            machine="Cooling-water pump P-2",
            created="2026-10-17T12:00:00+00:00",
            file="video.mp4",
            fps=240.0,
            nominal_fps=240.0,
            duration_s=8.0,
            size=(1280, 720),
            stills=0,
            audio_fs=FS_AUDIO,
            analysis=analysis,
        )
    )
    return scan_id


def _open_case(api: TestClient, **settings) -> dict:
    body = {"fault": "imbalance", "severity": 0.15, "seed": 2, "remember": False} | settings
    return api.post("/investigations", json=body).json()


def test_a_phone_scan_answers_the_envelope_check_through_the_one_door(api, monkeypatch):
    case = _open_case(api, extra_noise=0.2)
    assert case["request"]["test_id"] == "envelope"
    scan_id = _scan_on_file({"fps": 240.0, "rpm": case["rpm"], "lines": []})
    monkeypatch.setattr(scans, "sound", lambda _id: (_sound(FaultKind.HEALTHY), FS_AUDIO))

    r = api.post(f"/investigations/{case['id']}/evidence/phone", json={"scan_id": scan_id})

    assert r.status_code == 200, r.text
    after = r.json()
    assert [o["test_id"] for o in after["outcomes"]] == ["envelope"]
    assert after["phone_answers"][0]["scan_id"] == scan_id
    phone_lines = [e for e in after["ledger"] if e["statement"].startswith("phone scan")]
    assert phone_lines and "microphone" in phone_lines[0]["statement"]
    assert open_request(_INVESTIGATIONS[case["id"]].state) != "envelope"


def test_a_check_a_phone_cannot_measure_is_refused_before_any_scan_is_read(api):
    case = _open_case(api, extra_noise=0.5)
    assert case["request"]["test_id"] == "temperature"
    r = api.post(f"/investigations/{case['id']}/evidence/phone", json={"scan_id": "S-none"})
    assert r.status_code == 422 and "thermometer" in r.json()["detail"]


def test_a_scan_at_another_speed_is_refused(api, monkeypatch):
    case = _open_case(api, extra_noise=0.2)
    scan_id = _scan_on_file({"fps": 240.0, "rpm": case["rpm"] * 0.8, "lines": []})
    monkeypatch.setattr(scans, "sound", lambda _id: (_sound(FaultKind.HEALTHY), FS_AUDIO))
    r = api.post(f"/investigations/{case['id']}/evidence/phone", json={"scan_id": scan_id})
    assert r.status_code == 422 and "rpm" in r.json()["detail"]


def test_an_unanalysed_scan_is_refused(api):
    case = _open_case(api, extra_noise=0.2)
    scan_id = _scan_on_file(None)
    r = api.post(f"/investigations/{case['id']}/evidence/phone", json={"scan_id": scan_id})
    assert r.status_code == 422 and "speed" in r.json()["detail"]


def test_an_unknown_scan_or_case_is_not_found(api):
    case = _open_case(api, extra_noise=0.2)
    assert (
        api.post(
            f"/investigations/{case['id']}/evidence/phone", json={"scan_id": "S-x"}
        ).status_code
        == 404
    )
    assert (
        api.post("/investigations/nope/evidence/phone", json={"scan_id": "S-x"}).status_code == 404
    )


def test_a_case_not_waiting_on_a_measurement_takes_no_phone_reading(api):
    case = _open_case(api, extra_noise=0.05, severity=1.0, fault="outer_race")
    assert case["outcome"] != "open"
    r = api.post(f"/investigations/{case['id']}/evidence/phone", json={"scan_id": "S-x"})
    assert r.status_code == 409
