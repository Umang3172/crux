"""Repair tickets: the planned-stop odds, the evidence check, the camera look and
the endpoints. Offline throughout: no model is called."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from hypothesis_engine.api import maintenance
from hypothesis_engine.api.app import app
from hypothesis_engine.fleet import memory
from hypothesis_engine.forecast import health, replay
from hypothesis_engine.forecast.models import Forecast
from hypothesis_engine.forecast.schedule import risk_before
from hypothesis_engine.ticket import camera, photo
from hypothesis_engine.ticket.draft import Evidence, Sentence, check, draft
from test_forecast import _run  # tests/ is on the path, not a package


def _photo(width=640, height=480, seed=0, square=None, level=None) -> bytes:
    """A sharp, textured JPEG; `square` (left, top, right, bottom) is painted red."""
    from io import BytesIO

    import numpy as np
    from PIL import Image
    from scipy.ndimage import gaussian_filter

    if level is not None:
        rgb = np.full((height, width, 3), float(level))
    else:
        rng = np.random.default_rng(seed)
        scene = gaussian_filter(rng.uniform(0, 255, (height, width)), 1.5)
        scene = (scene - scene.min()) / np.ptp(scene) * 200 + 25
        rgb = np.repeat(scene[:, :, None], 3, axis=2)
    if square is not None:
        left, top, right, bottom = square
        rgb[top:bottom, left:right] = (230, 20, 20)
    out = BytesIO()
    Image.fromarray(rgb.astype(np.uint8)).save(out, format="JPEG", quality=92)
    return out.getvalue()


# ---------------------------------------------------------------- planned stop


def test_risk_is_half_at_the_median_and_follows_the_range() -> None:
    f = Forecast(60 * 2, 60 * 10, 60 * 50, "t")  # 2 h, 10 h, 50 h
    assert risk_before(f, 10.0) == pytest.approx(0.5)
    assert risk_before(f, 2.0) == pytest.approx(0.1, abs=1e-3)
    assert risk_before(f, 50.0) == pytest.approx(0.9, abs=1e-3)
    assert risk_before(f, 0.0) == 0.0


def test_at_the_line_any_wait_is_too_long() -> None:
    assert risk_before(Forecast(0, 0, 0, "t"), 1.0) == 1.0


# ---------------------------------------------------------------- the check

EV = [
    Evidence("E1", "sensor", "health 41%", (41.3,)),
    Evidence("E3", "forecast", "3 to 34 h", (3.2, 29.0, 34.4)),
]


def test_sentences_keep_only_numbers_their_evidence_holds() -> None:
    kept, removed = check(
        [
            Sentence("Health reads 41%.", ("E1",)),
            Sentence("Fix within 3.2 to 34 hours.", ("E3",)),
            Sentence("Fix within 3 to 34 hours, about 80% sure.", ("E3",)),  # 80 is made up
            Sentence("Health reads 41%.", ("E9",)),  # cites nothing real
            Sentence("Replace it.", ()),  # cites nothing
        ],
        EV,
    )
    assert [s.text for s in kept] == ["Health reads 41%.", "Fix within 3.2 to 34 hours."]
    assert len(removed) == 3


class _Liar:
    name = "liar"

    def write(self, evidence, facts):
        return [
            Sentence("It will fail in exactly 6 hours.", ("E3",)),
            Sentence("Health is 41%.", ("E1",)),
        ]


def _ticket(**over):
    args = dict(
        ticket_id="T-1",
        machine="m",
        machine_name="Rig A",
        part="p",
        part_label="Bearing 3",
        bearing="LDK UER204",
        at_h=10.0,
        percent=41.0,
        level=3.4,
        alarm_h=8.0,
        time_left=(3.2, 29.0, 34.4),
        stop_in_h=24.0,
        risk=0.43,
        look=None,
        has_still=False,
    )
    args.update(over)
    return draft(**args)


def test_a_model_cannot_slip_in_a_number_nobody_measured() -> None:
    t = _ticket(writer=_Liar())
    texts = [s.text for s in t.sentences]
    assert "Health is 41%." in texts and "It will fail in exactly 6 hours." not in texts
    assert [s.text for s in t.removed] == ["It will fail in exactly 6 hours."]


def test_the_offline_ticket_passes_its_own_check() -> None:
    t = _ticket()
    assert t.written_by == "template" and not t.removed
    text = " ".join(s.text for s in t.sentences)
    assert "3.2 to 34 hours" in text and "is 43%" in text and "LDK UER204" in text
    assert "Not investigated yet" in text and t.status == "draft"


# ---------------------------------------------------------------- camera


def test_a_still_comes_from_the_registry_and_is_attached_unread_offline(tmp_path) -> None:
    img = tmp_path / "bay.jpg"
    img.write_bytes(b"\xff\xd8fake")
    reg = {"m": {"kind": "file", "path": str(img), "label": "Bay 2 camera"}}
    still = camera.snapshot("m", reg)
    assert still is not None and still.image == b"\xff\xd8fake" and still.camera == "Bay 2 camera"
    assert camera.snapshot("other", reg) is None
    look = camera.inspect(still, "ctx", camera.NoInspector())
    assert look.findings == [] and "nobody has looked" in look.note
    t = _ticket(look=look, has_still=True)
    assert any("nobody has looked at it yet" in s.text for s in t.sentences)


class _Seer:
    name = "seer"

    def look(self, still, context, reference=None):
        return [camera.Finding("oil on the floor", "below the housing", 0.0, hazard=False)]


def test_what_the_camera_saw_is_marked_unconfirmed(tmp_path) -> None:
    still = camera.Still("m", "Bay 2 camera", _photo(), "image/jpeg", "now")
    t = _ticket(look=camera.inspect(still, "ctx", _Seer()), has_still=True)
    s = next(s for s in t.sentences if "E5" in s.cites)
    assert "oil on the floor" in s.text and "Not confirmed" in s.text


# ---------------------------------------------------------------- endpoints


@pytest.fixture
def server(tmp_path, monkeypatch):
    monkeypatch.setattr(replay, "REPLAY_FILE", tmp_path / "replay.json")
    monkeypatch.setattr(camera, "REGISTRY", tmp_path / "cameras.json")
    monkeypatch.setattr(memory, "MEMORY_FILE", tmp_path / "memory.jsonl")
    maintenance._machines.cache_clear()
    health.save([_run("xjtu/c/Bearing1_1", 240, 120)], tmp_path / "health_xjtu.csv")
    (tmp_path / "still.jpg").write_bytes(b"\xff\xd8still")
    (tmp_path / "cameras.json").write_text(
        json.dumps({"xjtu/c/Bearing1_1": {"kind": "file", "path": str(tmp_path / "still.jpg")}})
    )
    yield TestClient(app)
    maintenance._machines.cache_clear()


def test_a_ticket_needs_an_alarm_then_carries_the_still_and_waits_for_a_person(server) -> None:
    c = server
    m = c.get("/maintenance/machines/xjtu/c/Bearing1_1").json()
    part = m["parts"][0]
    early = c.post(
        "/maintenance/tickets", json={"machine": m["machine"], "part": part["part"], "at_h": 0.5}
    )
    assert early.status_code == 409
    at = part["alarm_h"] + 0.5
    r = c.get(
        "/maintenance/risk",
        params={"machine": m["machine"], "part": part["part"], "at_h": at, "stop_in_h": 1},
    )
    assert 0.0 <= r.json()["risk"] <= 1.0
    t = c.post(
        "/maintenance/tickets",
        json={"machine": m["machine"], "part": part["part"], "at_h": at, "stop_in_h": 1},
    ).json()
    assert t["status"] == "draft" and t["has_still"] and not t["removed"]
    assert c.get(f"/maintenance/tickets/{t['id']}/still").content == b"\xff\xd8still"
    assert c.post(f"/maintenance/tickets/{t['id']}/approve", json={"by": ""}).status_code == 422
    done = c.post(f"/maintenance/tickets/{t['id']}/approve", json={"by": "Asha"}).json()
    assert done["status"] == "approved" and done["approved_by"] == "Asha"


def test_a_near_certain_chance_is_never_written_as_certain() -> None:
    t = _ticket(risk=0.99996)
    s = next(s for s in t.sentences if "E4" in s.cites)
    assert "more than 99%" in s.text and "100%" not in s.text


class _Forgetful:
    name = "forgetful"

    def write(self, evidence, facts):
        return [Sentence("Health reads 41% (E1).", ("E1",))]


def test_what_a_model_leaves_out_is_put_back_from_templates() -> None:
    t = _ticket(writer=_Forgetful())
    cited = {c for s in t.sentences for c in s.cites}
    assert {"E1", "E2", "E3", "E4", "E6", "E7"} <= cited
    assert t.sentences[0].text == "Health reads 41%."  # inline citation stripped
    assert any("added from templates" in n for n in t.notes)


def test_citation_marks_a_model_leaves_in_its_text_are_removed() -> None:
    class _Marks:
        name = "marks"

        def write(self, evidence, facts):
            return [
                Sentence("Health reads 41% [E1]}.", ("E1",)),
                Sentence("Run on 40Hz10kN at 10 kN (E0).", ("E0",)),
            ]

    t = _ticket(writer=_Marks(), machine_name="run 3-1 (40Hz10kN)")
    texts = [s.text for s in t.sentences]
    assert "Health reads 41%." in texts and "Run on 40Hz10kN at 10 kN." in texts


class _Doubter(_Seer):
    name = "doubter"

    def confirm(self, still, finding, reference=None):
        return False


def test_a_finding_the_second_look_does_not_confirm_is_left_out() -> None:
    still = camera.Still("m", "Bay 2 camera", _photo(), "image/jpeg", "now")
    look = camera.inspect(still, "ctx", _Doubter())
    assert look.findings == [] and "not confirmed" in look.note and look.dropped == 1


def test_a_sentence_that_drops_the_chance_does_not_count_as_stating_it() -> None:
    class _Vague:
        name = "vague"

        def write(self, evidence, facts):
            return [Sentence("There is a planned stop in 24 hours.", ("E4",))]

    t = _ticket(writer=_Vague())
    e4 = [s.text for s in t.sentences if "E4" in s.cites]
    assert e4 and all("43%" in x for x in e4)


# ---------------------------------------------------------------- the photo check


def _answers(**present) -> dict:
    """A checklist reply: every item absent except those given as item=box."""
    out = {}
    for item in camera.ITEMS:
        box = present.get(item)
        out[item] = {
            "status": "present" if box else "absent",
            "severity": "medium" if box else "none",
            "box": list(box) if box else [],
            "evidence": f"{item} near the base" if box else "",
            "new_since_reference": "yes" if box else "no",
        }
    return out


class _Checklist:
    """A fake inspector that answers the checklist and records what it was shown."""

    name = "checklist"

    def __init__(self, reply: dict, confirms: bool = True) -> None:
        self.reply, self.confirms, self.seen = reply, confirms, []

    def look(self, still, context, reference=None):
        self.seen.append(("look", still, reference))
        return camera.findings_from(self.reply, reference is not None)

    def confirm(self, crop, finding, reference=None):
        self.seen.append(("confirm", crop, reference))
        return camera.Second(self.confirms, "yes" if reference is not None else "no_reference")


class _Blind:
    name = "blind"

    def look(self, still, context, reference=None):
        raise AssertionError("a model was asked about a photo the gate should turn back")


@pytest.mark.parametrize(
    ("image", "why"),
    [
        (_photo(level=4), "too dark"),
        (_photo(level=252), "blown out"),
        (_photo(width=200, height=150), "too small"),
        (b"\xff\xd8not a jpeg", "could not be read"),
    ],
)
def test_the_gate_turns_back_an_unusable_photo_before_any_model(image, why) -> None:
    look = camera.inspect(camera.Still("m", "Bay 2", image, "image/jpeg", "now"), "ctx", _Blind())
    assert why in look.retake and look.findings == [] and "Take the photo again" in look.note
    # The ticket then says, truly, that nobody has looked at the still.
    assert look.inspected_by == camera.NOBODY
    t = _ticket(look=look, has_still=True)
    assert any("nobody has looked at it yet" in s.text for s in t.sentences)


def test_the_gate_turns_back_a_blurred_photo() -> None:
    from io import BytesIO

    from PIL import Image, ImageFilter

    out = BytesIO()
    Image.open(BytesIO(_photo())).filter(ImageFilter.GaussianBlur(6)).save(out, format="JPEG")
    assert not photo.quality(out.getvalue()).usable
    assert photo.quality(_photo()).usable


def test_a_present_item_the_cropped_second_look_rejects_is_dropped() -> None:
    still = camera.Still("m", "Bay 2", _photo(), "image/jpeg", "now")
    fake = _Checklist(_answers(leak=(600, 300, 800, 500)), confirms=False)
    look = camera.inspect(still, "ctx", fake)
    assert look.findings == [] and look.dropped == 1 and "not confirmed" in look.note
    assert len(look.checklist) == len(camera.ITEMS)
    # The second look saw a crop around the box, not the whole photo.
    crop = next(s for kind, s, _ in fake.seen if kind == "confirm")
    assert len(crop.image) < len(still.image)
    kept = camera.inspect(still, "ctx", _Checklist(_answers(leak=(600, 300, 800, 500))))
    assert [f.item for f in kept.findings] == ["leak"] and kept.dropped == 0


def test_the_normal_photo_reaches_both_looks(tmp_path, monkeypatch) -> None:
    (tmp_path / "now.jpg").write_bytes(_photo(seed=1))
    (tmp_path / "normal.jpg").write_bytes(_photo(seed=2))
    reg = {
        "m": {
            "kind": "file",
            "path": str(tmp_path / "now.jpg"),
            "label": "Bay 2",
            "normal": str(tmp_path / "normal.jpg"),
        }
    }
    monkeypatch.setattr(camera, "REGISTRY", tmp_path / "cameras.json")
    (tmp_path / "cameras.json").write_text(json.dumps(reg))
    box = (100, 100, 300, 400)
    fake = _Checklist(_answers(corrosion=box))
    look = camera.inspect(camera.snapshot("m"), "ctx", fake)
    first_ref = next(r for kind, _, r in fake.seen if kind == "look")
    second_ref = next(r for kind, _, r in fake.seen if kind == "confirm")
    assert first_ref.image == (tmp_path / "normal.jpg").read_bytes()
    # The second look gets the same region of the reference as of the new photo.
    assert second_ref.image == photo.crop(first_ref.image, box)
    assert look.reference == "Bay 2, normal photo"
    assert look.findings[0].new_since_reference == "yes"
    without = camera.inspect(camera.snapshot("m"), "ctx", _Checklist({}), use_registry=False)
    assert without.reference == ""


def test_boxes_keep_one_convention_from_model_to_crop_to_screen() -> None:
    assert photo.parse_box([800, 600, 200, 100]) == (200, 100, 800, 600)  # corners swapped
    assert photo.parse_box([-50, 10, 1200, 500]) == (0, 10, 1000, 500)  # clamped
    assert photo.parse_box([1, 2, 3]) is None and photo.parse_box([10, 10, 12, 12]) is None
    box = (250, 100, 500, 400)  # ymin, xmin, ymax, xmax
    px = photo.to_pixels(box, 640, 480)
    assert px == (64, 120, 256, 240)  # left, top, right, bottom
    assert photo.from_pixels(*px, 640, 480) == box
    assert photo.to_fractions(box) == pytest.approx((0.1, 0.25, 0.3, 0.25))
    # A red square where the box says is inside the crop the second look gets.
    from io import BytesIO

    import numpy as np
    from PIL import Image

    image = _photo(square=px)
    crop = np.asarray(Image.open(BytesIO(photo.crop(image, box))))
    red = (crop[:, :, 0] > 180) & (crop[:, :, 1] < 80)
    assert red.mean() > 0.2  # the square fills a good part of the crop, margin around it
    left, top, right, bottom = photo.to_pixels(photo.crop_box(box), 640, 480)
    assert crop.shape[:2] == (bottom - top, right - left)


def test_a_model_that_cannot_see_anything_asks_for_a_retake() -> None:
    blind = {i: {**_answers()[i], "status": "cannot_see"} for i in camera.ITEMS}
    look = camera.inspect(
        camera.Still("m", "Bay 2", _photo(), "image/jpeg", "now"), "ctx", _Checklist(blind)
    )
    assert look.findings == [] and "could not see enough" in look.retake


def test_checklist_answers_parse_and_malformed_ones_read_as_unsure() -> None:
    reply = _answers(smoke=(0, 0, 500, 500))
    reply["leak"] = {"status": "maybe", "box": "x"}
    del reply["crack"]
    found = {f.item: f for f in camera.findings_from(reply, with_reference=False)}
    assert found["leak"].status == "unsure" and found["crack"].status == "unsure"
    assert found["smoke"].hazard and found["smoke"].box == (0, 0, 500, 500)
    assert found["smoke"].new_since_reference == "no_reference"  # no reference was shown
    assert found["corrosion"].status == "absent" and found["corrosion"].box is None


def test_the_gemini_reply_is_read_from_its_last_json_part() -> None:
    from types import SimpleNamespace as NS

    parts = [
        NS(text="Let me zoom in.", thought=False, executable_code=None),
        NS(text=None, thought=False, executable_code=NS(code="crop()")),
        NS(text=json.dumps({"visible": True}), thought=False, executable_code=None),
    ]
    response = NS(candidates=[NS(content=NS(parts=parts))], text="")
    gemini = camera.GeminiInspector.__new__(camera.GeminiInspector)  # no client, no network
    gemini.zooms = 0
    assert gemini._json(response) == {"visible": True} and gemini.zooms == 1


def test_the_local_model_gets_reference_then_now(monkeypatch) -> None:
    from hypothesis_engine.agents import ollama

    calls = []

    def chat(prompt, *, schema=None, images=None, system=None, temperature=None):
        calls.append((prompt, images, schema))
        if schema is camera.SCHEMA:
            return json.dumps(_answers(belt=(100, 100, 400, 400)))
        return json.dumps({"visible": True, "new_since_reference": "yes", "evidence": "torn"})

    monkeypatch.setattr(ollama, "available", lambda timeout_s=1.0: True)
    monkeypatch.setattr(ollama, "model", lambda: "gemma4:test")
    monkeypatch.setattr(ollama, "chat", chat)
    now, ref = _photo(seed=3), _photo(seed=4)
    look = camera.inspect(
        camera.Still("m", "Bay 2", now, "image/jpeg", "t"),
        "ctx",
        camera.LocalInspector(),
        reference=camera.Still("m", "normal", ref, "image/jpeg", "t"),
    )
    prompt, images, _ = calls[0]
    assert images == [ref, now] and "REFERENCE" in prompt and "NOW" in prompt
    assert [f.item for f in look.findings] == ["belt"] and look.inspected_by == "ollama:gemma4:test"


def test_a_camera_finding_never_moves_a_belief() -> None:
    import ast
    from pathlib import Path

    from hypothesis_engine.data.rig import BENCH_RIG, synthetic_capture
    from hypothesis_engine.investigation.engine import Investigation
    from hypothesis_engine.lens import look as lens_look
    from hypothesis_engine.models import FaultKind

    inv = Investigation(BENCH_RIG, synthetic_capture(FaultKind.IMBALANCE, BENCH_RIG))
    inv.observe()
    inv.run_virtual_experiments()
    before = {h.kind: h.posterior for h in inv.state.hypotheses}
    ledger = list(inv.ledger.ids())
    everything = _answers(**{i: (100, 100, 600, 600) for i in camera.ITEMS})
    still = camera.Still(BENCH_RIG.machine_id, "Bay 2", _photo(), "image/jpeg", "now")
    seen = camera.inspect(still, "ctx", _Checklist(everything))
    assert len(seen.findings) == len(camera.ITEMS)  # the camera "saw" everything...
    assert {h.kind: h.posterior for h in inv.state.hypotheses} == before  # ...and nothing moved
    assert list(inv.ledger.ids()) == ledger
    # And no path exists: neither the camera nor the lens look imports the engine.
    for module in (camera, photo, lens_look):
        tree = ast.parse(Path(module.__file__).read_text())
        names = [
            getattr(node, "module", "") or ""
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom | ast.Import)
        ] + [a.name for node in ast.walk(tree) if isinstance(node, ast.Import) for a in node.names]
        assert not any("investigation" in n for n in names), module.__name__


def _photo_eval():
    import importlib.util
    import sys
    from pathlib import Path

    path = Path(__file__).parents[1] / "scripts" / "photo_eval.py"
    spec = importlib.util.spec_from_file_location("photo_eval", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["photo_eval"] = mod  # its dataclasses resolve names through sys.modules
    spec.loader.exec_module(mod)
    return mod


class _SeesRed(_Checklist):
    """Reports a leak wherever the photo has a red patch; nothing otherwise."""

    def __init__(self) -> None:
        super().__init__({})

    def look(self, still, context, reference=None):
        from io import BytesIO

        import numpy as np
        from PIL import Image

        a = np.asarray(Image.open(BytesIO(still.image)).convert("RGB")).astype(int)
        red = (a[:, :, 0] > 180) & (a[:, :, 1] < 80)
        if red.mean() < 0.01:
            return camera.findings_from(_answers(), reference is not None)
        ys, xs = np.nonzero(red)
        h, w = red.shape
        box = photo.from_pixels(xs.min(), ys.min(), xs.max(), ys.max(), w, h)
        return camera.findings_from(_answers(leak=box), reference is not None)


def test_photo_eval_scores_hits_and_false_alarms_on_the_rest(tmp_path, monkeypatch, capsys):
    pe = _photo_eval()
    for i in range(8):
        (tmp_path / "normal").mkdir(exist_ok=True)
        (tmp_path / "normal" / f"n{i}.jpg").write_bytes(_photo(seed=i))
        (tmp_path / "leak").mkdir(exist_ok=True)
        (tmp_path / "leak" / f"l{i}.jpg").write_bytes(
            _photo(seed=20 + i, square=(200, 300, 400, 420))
        )
    (tmp_path / "pairs.csv").write_text(
        "machine,reference,test_image,true_items\npump,normal/n0.jpg,leak/l0.jpg,leak\n"
    )
    monkeypatch.setattr(camera, "get_inspector", lambda: _SeesRed())
    out = tmp_path / "report.md"
    assert pe.main(["--root", str(tmp_path), "--out", str(out)]) == 0
    photos = pe.collect(tmp_path)
    scored = [p for p in photos if not p.calibration]
    leaks = sum(bool(p.labels) for p in scored)
    normals = len(scored) - leaks
    text = out.read_text()
    # Every leak photo is a hit and no normal photo is a false alarm, counted on the scored photos only.
    assert f"| Leak (oil, water or coolant) | {leaks} | {leaks}/{leaks} *" in text
    assert f"| 0/{normals} * |" in text
    assert (len(photos) - len(scored)) > 0 and "held out for calibration" in text


def test_photo_eval_needs_thirty_calibration_photos_before_moving_a_bar(tmp_path, capsys):
    pe = _photo_eval()
    (tmp_path / "normal").mkdir()
    for i in range(10):
        (tmp_path / "normal" / f"n{i}.jpg").write_bytes(_photo(seed=i))
    assert pe.main(["--root", str(tmp_path), "--calibrate"]) == 0
    assert "no recommendation" in capsys.readouterr().out
    with pytest.raises(ValueError, match="unknown checklist item"):
        pe.parse_label("leak+dent")
