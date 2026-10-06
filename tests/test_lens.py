"""Crux Lens: motion from video, virtual experiments on it, and the scan flow.

The videos here are synthetic (a textured scene whose middle shakes at known
shaft orders, plus hand shake), so these tests pin the measurement and the
logic, not real-world accuracy. That needs phone videos of real machines.
"""

from __future__ import annotations

import io

import numpy as np
import pytest
from scipy.ndimage import fourier_shift, gaussian_filter

from hypothesis_engine.lens import experiments as ex
from hypothesis_engine.lens import look
from hypothesis_engine.lens.motion import Box, measure, shake_map
from hypothesis_engine.models import SKF_6205_2RS_JEM, FaultKind, MachineSpec
from hypothesis_engine.physics.signatures import predicted_signature
from hypothesis_engine.physics.synth import synthesize
from hypothesis_engine.signals.features import magnitude_spectrum, peak_near

RPM = 1480.0
FR = RPM / 60.0
MACHINE = (0.35, 0.3, 0.3, 0.4)  # x, y, w, h of the shaking region
INSIDE = Box(0.37, 0.33, 0.26, 0.34)

MISALIGNED = ((1.0, 0.4), (2.0, 0.8), (3.0, 0.3))
LOOSE = ((0.5, 0.2), (1.0, 0.5), (1.5, 0.2), (2.0, 0.35), (3.0, 0.3), (4.0, 0.2))


def frames(fps=120.0, dur=3.0, comps=MISALIGNED, shake=1.2, w=320, h=180, seed=0):
    """Grey frames of a scene that shakes by hand, with a machine that shakes by itself."""
    rng = np.random.default_rng(seed)
    scene = gaussian_filter(rng.uniform(0, 255, (h, w)), 2.0)
    scene = (scene - scene.min()) / (scene.max() - scene.min()) * 200 + 25
    spec = np.fft.fft2(scene)
    n = int(fps * dur)
    t = np.arange(n) / fps
    x0, y0 = int(MACHINE[0] * w), int(MACHINE[1] * h)
    x1, y1 = x0 + int(MACHINE[2] * w), y0 + int(MACHINE[3] * h)
    phases = rng.uniform(0, 6, len(comps))
    out = np.empty((n, h, w), np.uint8)
    for i in range(n):
        s = shake * (np.sin(2 * np.pi * 3 * t[i]) + 0.5 * np.sin(2 * np.pi * 6.5 * t[i] + 1))
        img = np.fft.ifft2(fourier_shift(spec, (0.4 * s, s))).real
        d = sum(
            a * np.sin(2 * np.pi * o * FR * t[i] + p)
            for (o, a), p in zip(comps, phases, strict=True)
        )
        moved = np.fft.ifft2(fourier_shift(np.fft.fft2(img), (d, 0.3 * d))).real
        img[y0:y1, x0:x1] = moved[y0:y1, x0:x1]
        out[i] = np.clip(img + rng.normal(0, 1.0, img.shape), 0, 255).astype(np.uint8)
    return out, t


def motion_like(fps, comps, dur=6.0, seed=1):
    rng = np.random.default_rng(seed)
    t = np.arange(int(fps * dur)) / fps
    x = sum(a * np.sin(2 * np.pi * o * FR * t + rng.uniform(0, 6)) for o, a in comps)
    return x + rng.normal(0, 0.01, len(t))


# ---------------------------------------------------------------- motion


def test_motion_recovers_shaft_lines_and_removes_hand_shake():
    f, t = frames()
    m = measure(f, t, 120.0, INSIDE)
    assert m.shake_removed
    freqs, mag = magnitude_spectrum(m.signal, 120.0)
    one, two = peak_near(freqs, mag, FR, 0.5), peak_near(freqs, mag, 2 * FR, 0.5)
    shake = peak_near(freqs, mag, 3.0, 0.5)
    # The 2x line was set at twice the 1x; hand shake (1.2 px) is gone.
    assert 1.5 < two / one < 2.6
    assert shake < 0.1 * two
    assert 60 < m.direction_deg <= 90  # the machine shakes mostly up-down


def test_shake_map_boxes_the_part_that_shakes():
    f, t = frames()
    m = shake_map(f, t, 120.0)
    assert m.box is not None
    x, y, w, h = MACHINE
    # The box sits on the shaking region, not on the scene that only moves with the phone.
    cx, cy = m.box.x + m.box.w / 2, m.box.y + m.box.h / 2
    assert x < cx < x + w and y < cy < y + h
    assert m.box.x >= x - 0.05 and m.box.x + m.box.w <= x + w + 0.05


def test_shake_map_says_so_when_nothing_stands_out():
    f, t = frames(comps=((1.0, 0.0),))
    m = shake_map(f, t, 120.0)
    assert m.box is None and "no part of the picture" in m.note


# ---------------------------------------------------------------- physics


def test_aliasing_folds_lines_back():
    assert ex.seen_at(25.0, 240.0) == pytest.approx(25.0)
    assert ex.seen_at(74.0, 120.0) == pytest.approx(46.0)
    assert ex.seen_at(40.0, 60.0) == pytest.approx(20.0)


@pytest.mark.parametrize("fps", [240.0, 120.0, 30.0])
@pytest.mark.parametrize(
    ("comps", "kind"),
    [(MISALIGNED, FaultKind.MISALIGNMENT), (LOOSE, FaultKind.LOOSENESS)],
)
def test_camera_names_shaft_faults_by_shape_even_when_aliased(fps, comps, kind):
    scores = ex.camera_experiments(motion_like(fps, comps), fps, RPM)
    assert scores[0].kind is kind
    assert ex.consistent(scores) == [kind]
    assert scores[0].score - scores[1].score > ex.TIE


def test_camera_cannot_tell_healthy_from_out_of_balance_by_shape():
    scores = ex.camera_experiments(motion_like(120.0, ((1.0, 1.0), (2.0, 0.05))), 120.0, RPM)
    assert set(ex.consistent(scores)) == {FaultKind.IMBALANCE, FaultKind.HEALTHY}


def test_camera_blind_when_frame_rate_stacks_the_lines():
    # 2,400 rpm at 60 fps: 1x (40 Hz) and 2x (80 Hz) both appear at 20 Hz.
    lines = ex.lines(motion_like(60.0, MISALIGNED), 60.0, 2400.0)
    one, two = (ln for ln in lines if ln.order in (1.0, 2.0))
    assert abs(one.seen_hz - two.seen_hz) < ex.CAMERA_BIN_HZ


def _lines(comps):
    return ex.lines(motion_like(120.0, comps, seed=3), 120.0, RPM)


def test_growth_since_normal_scan_names_imbalance():
    normal = _lines(((1.0, 0.12), (2.0, 0.03)))
    coin = _lines(((1.0, 0.7), (2.0, 0.035)))
    change = ex.against_normal(coin, normal, 100.0, 100.0, RPM)
    assert change.scores[0].kind is FaultKind.IMBALANCE
    assert change.growth[1.0] > 4


def test_no_doubling_since_normal_names_nothing():
    a, b = _lines(((1.0, 0.12), (2.0, 0.03))), _lines(((1.0, 0.13), (2.0, 0.03)))
    assert ex.against_normal(a, b, 100.0, 100.0, RPM).scores == []


def test_box_scale_cancels_a_closer_phone():
    normal = _lines(((1.0, 0.12), (2.0, 0.03)))
    closer = _lines(((1.0, 0.24), (2.0, 0.06)))  # twice as big in pixels, same machine
    assert ex.against_normal(closer, normal, 200.0, 100.0, RPM).scores == []


def test_sound_names_bearing_damage_when_the_bearing_is_known():
    fs = 48_000.0
    machine = MachineSpec("x", "x", SKF_6205_2RS_JEM, RPM, fs)
    x = synthesize(predicted_signature(FaultKind.OUTER_RACE, machine, RPM, 0.8), fs, 3.0, seed=5)
    x = x + np.random.default_rng(1).normal(0, 0.3, len(x))
    scores, _ = ex.sound_experiments(x, fs, RPM, "SKF 6205-2RS")
    assert scores[0].kind is FaultKind.OUTER_RACE
    none, why = ex.sound_experiments(x, fs, RPM, "")
    assert none == [] and "bearing model not known" in why


def test_next_check_separates_what_is_left():
    test = ex.next_check([FaultKind.HEALTHY, FaultKind.IMBALANCE])
    assert test is not None
    a, b = test.predict(FaultKind.HEALTHY), test.predict(FaultKind.IMBALANCE)
    assert a is not None and b is not None and a != b
    assert ex.next_check([FaultKind.MISALIGNMENT]) is None


# ---------------------------------------------------------------- look


def test_model_box_is_read_as_fractions_and_bad_boxes_dropped():
    b = look.box_from({"x0": 100, "y0": 200, "x1": 500, "y1": 600})
    assert (b.x, b.y, b.w, b.h) == pytest.approx((0.1, 0.2, 0.4, 0.4))
    assert look.box_from({"x0": 500, "y0": 600, "x1": 100, "y1": 200}) == b  # corners swapped
    assert look.box_from({"x0": 1, "y0": 1, "x1": 20, "y1": 20}) is None  # too small
    assert look.box_from({"x0": "a"}) is None


def test_no_model_means_the_person_draws_the_box(monkeypatch):
    for key in ("GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "OLLAMA_MODEL"):
        monkeypatch.delenv(key, raising=False)
    who = look.identify(b"not an image")
    assert who.box is None and who.by == "nobody" and "draw the box" in who.note


def test_nameplate_text_stays_only_if_a_second_look_reads_it():
    said = {"machine_type": "motor", "nameplate_text": "MODEL 2000 220V", "box_label": "motor"}
    said["box"] = {"x0": 100, "y0": 100, "x1": 400, "y1": 400}

    def ask(legible):
        def _ask(prompt, schema, still):
            return (said if "legible" not in schema["properties"] else {"legible": legible}), "test"

        return _ask

    assert look._read(ask(True), b"jpg").nameplate_text == "MODEL 2000 220V"
    dropped = look._read(ask(False), b"jpg")
    assert dropped.nameplate_text == "" and "not confirmed" in dropped.note
    assert dropped.box is not None  # the rest of the reading stands


# ---------------------------------------------------------------- scan flow


def _video(fps=120.0, comps=MISALIGNED, seed=0) -> bytes:
    av = pytest.importorskip("av")
    f, _ = frames(fps=fps, comps=comps, seed=seed)
    buf = io.BytesIO()
    with av.open(buf, "w", format="mp4") as out:
        vs = out.add_stream("libx264", rate=int(fps))
        vs.width, vs.height, vs.pix_fmt = f.shape[2], f.shape[1], "yuv420p"
        vs.options = {"crf": "18"}
        for g in f:
            rgb = np.repeat(g[:, :, None], 3, axis=2)
            for pkt in vs.encode(av.VideoFrame.from_ndarray(rgb, format="rgb24")):
                out.mux(pkt)
        for pkt in vs.encode():
            out.mux(pkt)
    return buf.getvalue()


@pytest.fixture
def lens_dir(tmp_path, monkeypatch):
    from hypothesis_engine.lens import scan

    monkeypatch.setattr(scan, "LENS_DIR", tmp_path)
    for key in ("GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "OLLAMA_MODEL"):
        monkeypatch.delenv(key, raising=False)
    return tmp_path


def test_scan_reads_a_compressed_video_end_to_end(lens_dir):
    from hypothesis_engine.lens import scan

    s = scan.new_scan(_video(), "clip.mp4", "Test pump")
    assert s.fps == pytest.approx(120.0, rel=0.01)
    assert s.stills >= 1 and (lens_dir / s.id / "still_0.jpg").exists()
    # The strongest line on offer is the 2x of a misaligned shaft.
    assert abs(s.candidates[0]["hz"] - 2 * FR) < 1.0
    assert s.box_source == "where the video shakes most"
    a = scan.analyse(s.id, RPM)  # on the box the shake map chose
    assert a["standing"] == ["misalignment"]
    assert a["camera"][0]["kind"] == "misalignment"
    assert any("shafts out of line" in line for line in a["summary"])


def test_api_upload_analyse_and_mark_normal(lens_dir):
    from fastapi.testclient import TestClient

    from hypothesis_engine.api.app import app

    client = TestClient(app)
    r = client.post("/lens/scans?machine=Fan&look=false", content=_video(seed=2))
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    assert client.post(f"/lens/scans/{sid}/normal").status_code == 409  # analyse first
    box = {"x": INSIDE.x, "y": INSIDE.y, "w": INSIDE.w, "h": INSIDE.h}
    r = client.post(f"/lens/scans/{sid}/analyse", json={"rpm": RPM, "box": box})
    assert r.status_code == 200 and r.json()["summary"]
    assert client.post(f"/lens/scans/{sid}/normal").json()["normal"] is True
    assert client.get(f"/lens/scans/{sid}/still/0").headers["content-type"] == "image/jpeg"
    assert client.post("/lens/scans", content=b"").status_code == 400
    assert client.post("/lens/scans?look=false", content=b"not a video").status_code == 422
