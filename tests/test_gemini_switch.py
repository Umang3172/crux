"""One switch for every place a Gemini model is called.

Five call sites used to decide for themselves whether Gemini was on, each from
its own reading of the environment, and four of them fell back without a word.
With the login `.env.example` recommends, only one of the five turned on. No
test here calls a model: the adapters are stubbed where they would reach out.
"""

from __future__ import annotations

import importlib

import pytest
from typer.testing import CliRunner

from hypothesis_engine.agents import factory, preflight
from hypothesis_engine.cli import app
from hypothesis_engine.fleet import learn
from hypothesis_engine.lens import look
from hypothesis_engine.ticket import camera

# The package also exports a function called `draft`, which hides the module.
draft = importlib.import_module("hypothesis_engine.ticket.draft")

_SETTINGS = (
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_GENAI_USE_VERTEXAI",
    "GOOGLE_GENAI_USE_ENTERPRISE",
    "GOOGLE_CLOUD_PROJECT",
    "GEMINI_MODEL",
    "GEMINI_VISION_MODEL",
    "GEMINI_LENS_MODEL",
    "OLLAMA_MODEL",
)


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for name in _SETTINGS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(factory, "_FAILURES", {})


@pytest.fixture
def logged_in(monkeypatch):
    """Google Cloud's own login, the route `.env.example` recommends."""
    monkeypatch.setenv("GOOGLE_GENAI_USE_ENTERPRISE", "true")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "a-project")


def _refuse(*_args, **_kwargs):
    raise RuntimeError("no network in tests")


def test_with_no_credentials_every_call_site_is_off_and_none_is_tried(monkeypatch):
    monkeypatch.setattr(draft.GeminiWriter, "__init__", _refuse)
    monkeypatch.setattr(camera.GeminiInspector, "__init__", _refuse)
    monkeypatch.setattr(look, "_gemini", _refuse)
    said = factory.describe()
    assert {said[role] for role in factory.OTHER_ROLES} == {"offline"}
    assert isinstance(draft.get_writer(), draft.TemplateWriter)
    assert isinstance(camera.get_inspector(), camera.NoInspector)
    assert look.identify(b"not a picture").by == "nobody"
    assert not any(key.endswith("_not_live") for key in factory.describe())


def test_one_login_turns_every_call_site_on_and_a_failure_is_not_silent(monkeypatch, logged_in):
    pytest.importorskip("google.genai")
    from google import genai

    said = factory.describe()
    assert said["investigator"].startswith("gemini:")
    for role in factory.OTHER_ROLES:
        assert said[role].startswith("gemini:"), role

    # Each site now reaches for Gemini. Refuse it, and each says why it fell back.
    monkeypatch.setattr(draft.GeminiWriter, "__init__", _refuse)
    monkeypatch.setattr(camera.GeminiInspector, "__init__", _refuse)
    monkeypatch.setattr(look, "_gemini", _refuse)
    monkeypatch.setattr(genai, "Client", _refuse)
    assert isinstance(draft.get_writer(), draft.TemplateWriter)
    assert isinstance(camera.get_inspector(), camera.NoInspector)
    assert "Gemini failed" in look.identify(b"not a picture").note
    assert learn._worded({"situation": "s", "said": "a", "found": "b"}) is None
    said = factory.describe()
    for role in ("ticket_writer", "camera_look", "lens_look", "lesson_writer"):
        assert "no network in tests" in said[f"{role}_not_live"], role


def test_the_model_is_chosen_in_one_place(monkeypatch):
    assert factory.gemini_model_id() == factory.DEFAULT_GEMINI_MODEL
    assert factory.gemini_model_id("ticket_writer") == factory.DEFAULT_GEMINI_MODEL
    assert factory.gemini_model_id("lens_look") == factory.DEFAULT_LENS_MODEL
    monkeypatch.setenv("GEMINI_MODEL", "one-model")
    for role in (None, "ticket_writer", "lesson_writer", "report_writer", "camera_look"):
        assert factory.gemini_model_id(role) == "one-model", role
    assert factory.gemini_model_id("lens_look") == factory.DEFAULT_LENS_MODEL
    monkeypatch.setenv("GEMINI_VISION_MODEL", "a-vision-model")
    monkeypatch.setenv("GEMINI_LENS_MODEL", "a-pointing-model")
    assert factory.gemini_model_id("camera_look") == "a-vision-model"
    assert factory.gemini_model_id("lens_look") == "a-pointing-model"
    assert factory.gemini_model_id("ticket_writer") == "one-model"


def test_the_preflight_makes_no_call_when_gemini_is_off(monkeypatch):
    monkeypatch.setattr(preflight, "CHECKS", tuple((role, _refuse) for role, _ in preflight.CHECKS))
    results = preflight.run()
    assert [r.role for r in results] == [role for role, _ in preflight.CHECKS]
    assert {r.status for r in results} == {"off"}
    assert {r.detail for r in results} == {"no Gemini credentials"}


def test_the_preflight_reports_each_site_and_survives_one_that_fails(monkeypatch, logged_in):
    def missing():
        raise ImportError("no such package")

    checks = (
        ("investigator", lambda: "did its job"),
        ("narrator", _refuse),
        ("camera_look", missing),
    )
    monkeypatch.setattr(preflight, "CHECKS", checks)
    by_role = {r.role: r for r in preflight.run()}
    assert (by_role["investigator"].status, by_role["investigator"].detail) == ("ok", "did its job")
    assert by_role["narrator"].status == "failed"
    assert "no network in tests" in by_role["narrator"].detail
    assert by_role["camera_look"].status == "skipped"
    assert [r.role for r in preflight.run(only=("narrator",))] == ["narrator"]


def test_the_command_exits_cleanly_when_off_and_with_an_error_when_a_site_fails(monkeypatch):
    off = CliRunner().invoke(app, ["gemini-check"])
    assert off.exit_code == 0 and "it is off" in off.output
    assert "GOOGLE_CLOUD_PROJECT" in off.output, "it says what to set"

    monkeypatch.setenv("GOOGLE_API_KEY", "a-key")
    monkeypatch.setattr(preflight, "CHECKS", (("narrator", _refuse),))
    failed = CliRunner().invoke(app, ["gemini-check"])
    assert failed.exit_code == 1 and "failed" in failed.output
