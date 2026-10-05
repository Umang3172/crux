"""Repair tickets: the planned-stop odds, the evidence check, the camera look and
the endpoints. Offline throughout: no model is called."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from hypothesis_engine.api import maintenance
from hypothesis_engine.api.app import app
from hypothesis_engine.forecast import health, replay
from hypothesis_engine.forecast.models import Forecast
from hypothesis_engine.forecast.schedule import risk_before
from hypothesis_engine.ticket import camera
from hypothesis_engine.ticket.draft import Evidence, Sentence, check, draft
from test_forecast import _run  # tests/ is on the path, not a package

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
    assert [s.text for s in t.sentences] == ["Health is 41%."]
    assert [s.text for s in t.removed] == ["It will fail in exactly 6 hours."]


def test_the_offline_ticket_passes_its_own_check() -> None:
    t = _ticket()
    assert t.written_by == "template" and not t.removed
    text = " ".join(s.text for s in t.sentences)
    assert "3.2 to 34 hours" in text and "43% chance" in text and "LDK UER204" in text
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

    def look(self, still, context):
        return [camera.Finding("oil on the floor", "below the housing", 0.7, hazard=False)]


def test_what_the_camera_saw_is_marked_unconfirmed(tmp_path) -> None:
    still = camera.Still("m", "Bay 2 camera", b"x", "image/jpeg", "now")
    t = _ticket(look=camera.inspect(still, "ctx", _Seer()), has_still=True)
    s = next(s for s in t.sentences if "E5" in s.cites)
    assert "oil on the floor" in s.text and "Not confirmed" in s.text


# ---------------------------------------------------------------- endpoints


@pytest.fixture
def server(tmp_path, monkeypatch):
    monkeypatch.setattr(replay, "REPLAY_FILE", tmp_path / "replay.json")
    monkeypatch.setattr(camera, "REGISTRY", tmp_path / "cameras.json")
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
