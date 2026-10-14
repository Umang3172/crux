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

from hypothesis_engine.lens import bearings, datasets, look, phone
from hypothesis_engine.lens import experiments as ex
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


# ---------------------------------------------------------------- bearings


def test_a_generic_6205_still_reads_with_the_cwru_reference_values():
    from test_frequencies import CWRU_PUBLISHED  # tests/ is on the path

    found = bearings.lookup("6205").bearing
    assert found is not None and found.geometry is SKF_6205_2RS_JEM
    m = found.multipliers()
    assert m["bpfo"] == pytest.approx(CWRU_PUBLISHED["bpfo"], abs=1e-3)
    assert m["bpfi"] == pytest.approx(CWRU_PUBLISHED["bpfi"], abs=1e-3)


#: Tolerance per source: values published to 3 or 4 decimals, except the IMS
#: paper, which rounds to whole Hz at 33.3 Hz (half a Hz is 0.015 x shaft speed).
_TOL = {"Rexnord ZA-2115": 0.5 / (2000 / 60)}


@pytest.mark.parametrize("b", bearings.TABLE, ids=lambda b: b.name)
def test_every_bearing_reproduces_what_its_source_publishes(b):
    m = b.multipliers()
    for key in ("bpfo", "bpfi", "ftf"):
        if key in b.published:
            assert m[key] == pytest.approx(b.published[key], abs=_TOL.get(b.name, 1e-3)), key
    if b.ratio_only:
        # The ratio form carries no contact angle; the maker's own spin frequency,
        # rounded to 3 decimals like BPFO and BPFI, confirms 0 deg holds.
        assert 2 * m["bsf"] == pytest.approx(b.published["bsf_2x"], rel=2e-3)


def test_published_race_frequencies_must_add_up_to_whole_balls():
    with pytest.raises(ValueError, match="whole ball count"):
        bearings._ratio_only("X", "1", "1", "test", bpfo=3.0, bpfi=4.5)


def test_xjtu_bearing_is_the_authors_table():
    b = bearings.lookup("LDK UER204").bearing
    assert b is not None
    g = b.geometry
    assert (g.n_rolling_elements, g.ball_diameter_mm, g.pitch_diameter_mm) == (8, 7.92, 34.55)


@pytest.mark.parametrize(
    ("text", "name"),
    [
        ("SKF 6205-2RS", "SKF 6205-2RS JEM"),
        ("6205 2Z", "SKF 6205-2RS JEM"),
        ("NSK6205", "NSK 6205 DDU"),
        ("nsk 6205 ddu", "NSK 6205 DDU"),
        ("SNR 6204NREE", "SNR 6204NREE"),
        ("SNR 6204 C3", "SNR 6204C3"),
        ("62204EEC3", "SNR 62204EE"),
        ("UER 204", "LDK UER204"),
        ("Rexnord ZA-2115", "Rexnord ZA-2115"),
        ("6306-2RS", "SNR 6306NR"),
    ],
)
def test_nameplate_text_is_read_as_the_bearing_it_names(text, name):
    found = bearings.lookup(text).bearing
    assert found is not None and found.name == name
    assert ex.bearing_for(text) is not None


@pytest.mark.parametrize("text", ["62050", "16205", "UER2040", "", "motor 1450 rpm 2.2 kW"])
def test_numbers_that_only_contain_a_bearing_number_are_not_read_as_one(text):
    assert bearings.lookup(text).bearing is None and ex.bearing_for(text) is None


def test_a_number_made_in_two_designs_asks_for_the_full_designation():
    # NTN-SNR's sheets: 6204C3 has 7 balls, 6204NREE has 8; BPFO differs by 15%.
    r = bearings.lookup("6204")
    assert r.bearing is None and "more than one design" in r.note
    assert "7 balls" in r.note and "8 balls" in r.note


def test_a_maker_with_nothing_on_file_is_not_assumed_from_another():
    r = bearings.lookup("SKF 6206")
    assert r.bearing is None and "no SKF 6206 on file" in r.note
    # Two makers' 6205s agree within the slip window, so a third maker's reads as them.
    assert bearings.lookup("FAG 6205").bearing is not None


def test_sound_says_why_when_the_bearing_cannot_be_read():
    fs = 48_000.0
    x = np.random.default_rng(0).normal(0, 1, int(fs))
    scores, why = ex.sound_experiments(x, fs, RPM, "6204")
    assert scores == [] and "enter the full designation" in why


# ---------------------------------------------------------------- real recordings


def _mafaulda_csv(path, fs=50_000.0, seconds=0.4, shaft_hz=24.8, seed=0):
    """A file shaped like MaFaulDa's: 8 columns, no header, a low pulse once per turn."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(fs * seconds)) / fs
    tach = np.where((t * shaft_hz) % 1.0 < 0.05, 0.2, 4.6) + rng.normal(0, 0.3, len(t))
    mic = 0.1 * np.sin(2 * np.pi * 3000 * t) + rng.normal(0, 0.05, len(t))
    cols = [tach] + [rng.normal(0, 0.1, len(t)) for _ in range(6)] + [mic]
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savetxt(path, np.column_stack(cols), delimiter=",", fmt="%.6g")


def test_mafaulda_loader_reads_sound_speed_and_label(tmp_path):
    root = tmp_path / "mafaulda"
    _mafaulda_csv(root / "overhang" / "outer_race" / "20g" / "24.8.csv")
    rec = datasets.read_mafaulda(datasets.mafaulda_files(root)[0], root, keep=("overhang_radial",))
    assert rec.truth is FaultKind.OUTER_RACE and rec.added_mass_g == 20.0
    # Speed from the tachometer column, through noise of 0.3 V on 4.4 V pulses.
    assert rec.rpm == pytest.approx(24.8 * 60, rel=2e-3) and rec.rpm_source == "tachometer"
    assert rec.fs == 50_000.0 and len(rec.audio) == 20_000 and rec.name_hz == pytest.approx(24.8)
    assert "overhang_radial" in rec.channels and ex.bearing_for(rec.bearing) is not None


@pytest.mark.parametrize(
    ("rel", "truth", "mass"),
    [
        ("normal/12.288.csv", FaultKind.HEALTHY, 0.0),
        ("imbalance/35g/40.96.csv", FaultKind.IMBALANCE, 0.0),
        ("vertical-misalignment/1.90mm/30.72.csv", FaultKind.MISALIGNMENT, 0.0),
        ("underhang/cage_fault/6g/20.48.csv", None, 6.0),
        ("overhang/ball_fault/0g/22.3232.csv", None, 0.0),
    ],
)
def test_mafaulda_folders_name_the_cause(rel, truth, mass):
    from pathlib import Path

    assert datasets.mafaulda_label(Path(rel)) == (truth, mass)


def test_a_flat_tachometer_is_refused_not_guessed():
    with pytest.raises(ValueError, match="flat"):
        datasets.tach_rpm(np.ones(5000), 50_000.0)


def test_jung_loader_reads_the_signal_struct(tmp_path):
    from scipy.io import savemat

    fs = 51_200.0
    y = np.sin(2 * np.pi * 1000 * np.arange(int(fs * 0.5)) / fs)
    signal = {
        "x_values": {"start_value": 0.0, "increment": 1 / fs, "number_of_values": len(y)},
        "y_values": {"values": y[:, None], "quantity": "Pa"},
        "function_record": {"name": "microphone"},
    }
    savemat(tmp_path / "0Nm_BPFI_03.mat", {"Signal": signal})
    rec = datasets.read_jung(datasets.jung_files(tmp_path)[0])
    assert rec.truth is FaultKind.INNER_RACE and "0.3 mm" in rec.label
    assert rec.fs == pytest.approx(fs) and len(rec.audio) == len(y)
    assert rec.rpm == 3010.0 and bearings.lookup(rec.bearing).bearing.name == "NSK 6205 DDU"
    assert len(datasets.windows(rec, 0.2)) == 2


def test_phone_emulation_resamples_and_cuts_low_sound():
    fs = 50_000.0
    t = np.arange(int(fs)) / fs
    x = np.sin(2 * np.pi * 50 * t) + np.sin(2 * np.pi * 2000 * t)
    y, fy = phone.emulate(x, fs)
    assert fy == 48_000.0 and len(y) == 48_000
    f, mag = magnitude_spectrum(y, fy)
    # 50 Hz is two octaves below the 200 Hz corner: about -48 dB at fourth order.
    assert peak_near(f, mag, 50.0, 2.0) < 0.01 * peak_near(f, mag, 2000.0, 2.0)
    noisy, _ = phone.emulate(x, fs, snr_db=0.0, seed=1)
    assert np.var(noisy - y) == pytest.approx(np.mean(y**2), rel=0.1)


def _sound_eval():
    import importlib.util
    from pathlib import Path

    path = Path(__file__).parents[1] / "scripts" / "lens_sound_eval.py"
    spec = importlib.util.spec_from_file_location("lens_sound_eval", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_sound_eval_runs_on_files_shaped_like_the_datasets(tmp_path, monkeypatch, capsys):
    root = tmp_path / "mafaulda"
    _mafaulda_csv(root / "normal" / "24.8.csv")
    _mafaulda_csv(root / "overhang" / "outer_race" / "0g" / "24.8.csv", seed=1)
    monkeypatch.setattr(datasets, "MAFAULDA_DIR", root)
    monkeypatch.setattr(datasets, "JUNG_DIR", tmp_path / "absent")
    assert _sound_eval().main(["--workers", "1", "--label-check"]) == 0
    out = capsys.readouterr().out
    assert "| healthy | 1 |" in out and "Phone emulation" in out and "label check" in out


def test_sound_eval_prints_the_download_steps_when_nothing_is_there(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(datasets, "MAFAULDA_DIR", tmp_path / "absent")
    monkeypatch.setattr(datasets, "JUNG_DIR", tmp_path / "absent")
    assert _sound_eval().main([]) == 1
    assert "mafaulda" in capsys.readouterr().err


@pytest.mark.skipif(not datasets.mafaulda_files(), reason="MaFaulDa not downloaded (docs/LENS.md)")
def test_real_mafaulda_recordings_load():
    rec = datasets.read_mafaulda(datasets.mafaulda_files()[0])
    assert len(rec.audio) == 250_000
    # Within the 50 versus 51.2 kHz question (docs/LENS.md), never further.
    assert rec.name_hz and abs(rec.rpm / 60 / rec.name_hz - 1) < 0.05


@pytest.mark.skipif(
    not datasets.jung_files(), reason="Jung et al. sound not downloaded (docs/LENS.md)"
)
def test_real_jung_recordings_load():
    recs = [datasets.read_jung(p) for p in datasets.jung_files()]
    assert all(r.fs == pytest.approx(51_200.0) for r in recs)
    assert {r.truth for r in recs} == {
        FaultKind.HEALTHY,
        FaultKind.INNER_RACE,
        FaultKind.OUTER_RACE,
    }


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


def test_a_new_scan_is_looked_at_beside_the_machines_normal_scan(lens_dir, monkeypatch):
    from hypothesis_engine.lens import scan
    from hypothesis_engine.ticket import camera

    shown = []

    class Fake:
        name = "fake"

        def look(self, still, context, reference=None):
            shown.append(reference)
            return []

    monkeypatch.setattr(camera, "get_inspector", lambda: Fake())
    # The test video's stills are 320 x 180, which the gate rightly turns back
    # (tests/test_ticket.py); here only the plumbing of the reference is checked.
    monkeypatch.setattr(camera.photo, "quality", lambda image: camera.photo.Quality(True, ""))
    first = scan.new_scan(_video(seed=4), "a.mp4", "Fan")
    scan.analyse(first.id, RPM, box=INSIDE)
    scan.mark_normal(first.id)
    later = scan.new_scan(_video(seed=5), "b.mp4", "Fan")
    assert shown[0] is None  # the first scan had nothing to compare with
    assert shown[1].image == scan.still(first.id, first.stills // 2)
    assert later.look["reference"].startswith(f"normal scan {first.id}")


def _steps(body: str) -> list[dict]:
    import json

    return [json.loads(line) for line in body.splitlines() if line.strip()]


def test_live_scan_streams_each_step_as_it_runs_then_the_scan(lens_dir, monkeypatch):
    from fastapi.testclient import TestClient

    from hypothesis_engine.api.app import app
    from hypothesis_engine.ticket import camera

    leak = camera.Finding(
        "leak",
        "under the welded joint",
        0.0,
        item="leak",
        severity="high",
        box=(400, 450, 520, 620),
    )

    class Fake:
        name = "fake"

        def look(self, still, context, reference=None):
            return [leak, camera.Finding("rust", "on the pipe", 0.0, item="rust", status="absent")]

        def confirm(self, crop, finding, reference=None):
            return True

    monkeypatch.setattr(camera, "get_inspector", lambda: Fake())
    monkeypatch.setattr(camera.photo, "quality", lambda image: camera.photo.Quality(True, ""))
    r = TestClient(app).post("/lens/scans/live?machine=Pipework", content=_video(seed=6))
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/x-ndjson")
    lines = _steps(r.text)
    seen = [(x["step"], x["state"]) for x in lines]
    # Naming, the look and the motion run side by side, so their lines interleave;
    # each still starts before it ends, and the look before its second look.
    assert seen[:2] == [("read", "start"), ("read", "done")]
    assert seen[-3:] == [("sound", "waiting"), ("save", "done"), ("scan", "done")]
    side = seen[2:-3]
    assert sorted(side) == sorted(
        [
            ("identify", "start"),
            ("identify", "done"),
            ("gate", "done"),
            ("look", "start"),
            ("look", "done"),
            ("confirm", "start"),
            ("confirm", "done"),
            ("motion", "start"),
            ("motion", "done"),
        ]
    )
    for a, b in [
        (("identify", "start"), ("identify", "done")),
        (("motion", "start"), ("motion", "done")),
        (("gate", "done"), ("look", "start")),
        (("look", "done"), ("confirm", "start")),
        (("confirm", "start"), ("confirm", "done")),
    ]:
        assert side.index(a) < side.index(b)
    by = {(x["step"], x["state"]): x for x in lines}
    assert by[("read", "done")]["detail"]["fps"] == pytest.approx(120.0, rel=0.01)
    assert [f["item"] for f in by[("look", "done")]["detail"]["present"]] == ["leak"]
    assert by[("confirm", "done")]["detail"]["kept"][0]["box"] == [400, 450, 520, 620]
    scan = by[("scan", "done")]["scan"]
    assert (
        scan["id"] == by[("read", "done")]["detail"]["id"] == by[("save", "done")]["detail"]["id"]
    )
    assert scan["look"]["findings"][0]["item"] == "leak"
    assert scan["candidates"] == by[("motion", "done")]["detail"]["candidates"]


def test_naming_and_the_look_run_at_the_same_time(lens_dir, monkeypatch):
    import threading

    from hypothesis_engine.lens import look as looks
    from hypothesis_engine.lens import scan

    naming, looking = threading.Event(), threading.Event()
    overlapped = {}

    def identify(still):
        naming.set()
        overlapped["identify"] = looking.wait(5)  # one after the other, this times out
        return looks.Identity(machine_type="pump", by="fake")

    def visible(still, context, reference=None, reference_label="", on_step=None):
        looking.set()
        overlapped["look"] = naming.wait(5)
        return None

    monkeypatch.setattr(looks, "identify", identify)
    monkeypatch.setattr(looks, "visible", visible)
    s = scan.new_scan(_video(seed=8), "a.mp4", "Pump")
    assert overlapped == {"identify": True, "look": True}
    assert s.identity["machine_type"] == "pump"


def test_live_scan_without_a_model_says_the_look_is_off(lens_dir):
    from fastapi.testclient import TestClient

    from hypothesis_engine.api.app import app

    client = TestClient(app)
    lines = _steps(client.post("/lens/scans/live?look=false", content=_video(seed=7)).text)
    assert ("look", "off") in [(x["step"], x["state"]) for x in lines]
    assert lines[-1]["step"] == "scan"
    bad = _steps(client.post("/lens/scans/live?look=false", content=b"not a video").text)
    assert bad[-1]["step"] == "error" and "could not read" in bad[-1]["detail"]["message"]
    assert client.post("/lens/scans/live", content=b"").status_code == 400
