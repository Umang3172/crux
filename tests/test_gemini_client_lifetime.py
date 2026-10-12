"""A Gemini client must outlive the request it sends.

The SDK's `Client` closes its connection when it is garbage-collected, so
`genai.Client().models.generate_content(...)` on one line closes the client
before the request goes out ("Cannot send a request, as the client has been
closed"). A stand-in client with the same behaviour shows it without a network.
"""

from __future__ import annotations

import sys
import types
from types import SimpleNamespace

import pytest

from hypothesis_engine.fleet import learn
from hypothesis_engine.lens import look


class _Connection:
    closed = False


class _Models:
    def __init__(self, connection: _Connection) -> None:
        self._connection = connection

    def generate_content(self, **_: object) -> SimpleNamespace:
        if self._connection.closed:
            raise RuntimeError("Cannot send a request, as the client has been closed.")
        return SimpleNamespace(text='{"ok": true}')


class _Client:
    """Closes its connection when collected, as `google.genai.Client` does."""

    def __init__(self, *_: object, **__: object) -> None:
        self._connection = _Connection()
        self.models = _Models(self._connection)

    def __del__(self) -> None:
        self._connection.closed = True


@pytest.fixture
def fake_genai(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_types = types.ModuleType("google.genai.types")
    fake_types.GenerateContentConfig = lambda **kw: kw  # type: ignore[attr-defined]
    fake_types.HttpOptions = lambda **kw: kw  # type: ignore[attr-defined]
    fake_types.Part = SimpleNamespace(from_bytes=lambda **kw: kw)  # type: ignore[attr-defined]
    fake = types.ModuleType("google.genai")
    fake.Client = _Client  # type: ignore[attr-defined]
    fake.types = fake_types  # type: ignore[attr-defined]
    if "google" not in sys.modules:
        monkeypatch.setitem(sys.modules, "google", types.ModuleType("google"))
    monkeypatch.setattr(sys.modules["google"], "genai", fake, raising=False)
    monkeypatch.setitem(sys.modules, "google.genai", fake)
    monkeypatch.setitem(sys.modules, "google.genai.types", fake_types)


def test_the_lens_look_keeps_its_client_open(fake_genai: None) -> None:
    answer, by = look._gemini("prompt", {"type": "object"}, b"jpeg")
    assert answer == {"ok": True}
    assert by.startswith("gemini:")


def test_the_lesson_writer_keeps_its_client_open(
    fake_genai: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(learn, "gemini_route", lambda: "API key")
    assert learn._worded({"situation": "test"}) == {"ok": True}
