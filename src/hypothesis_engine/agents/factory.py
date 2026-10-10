"""Pick the best available implementation for each model role.

Order of preference, per role:

    Investigator : Gemini (Google Cloud login, or an API key) -> scripted offline policy
    Narrator     : Gemini                                      -> template
    Gate         : Jev (TYPESAFE_API_KEY)                      -> rules

Never raises because a credential is missing, and never hides why an adapter
is not live: `describe()` says what is actually running and, when a live
adapter failed to start, why. That is the first thing to put in a demo video.
"""

from __future__ import annotations

import os
from typing import Any

from .offline import RuleGate, TemplateNarrator
from .protocols import Gate, Narrator

#: The Gemini model used when `GEMINI_MODEL` is not set. Stable, supports function
#: calling, structured output and thinking, with a free tier (ai.google.dev model
#: list, checked 2 Oct 2026). Model ids change; set `GEMINI_MODEL` to move.
DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"

# Why a live adapter is not running, per role, for `describe()`.
_FAILURES: dict[str, str] = {}

_TRUE = {"1", "true", "yes"}


def gemini_model_id() -> str:
    return os.getenv("GEMINI_MODEL") or DEFAULT_GEMINI_MODEL


def gemini_route() -> str | None:
    """How Gemini would be reached, or None when no credentials are configured.

    Google Cloud's own login (Application Default Credentials, as a Cloud Run
    service account has) is preferred over an API key. The SDK reads
    GOOGLE_GENAI_USE_ENTERPRISE; GOOGLE_GENAI_USE_VERTEXAI is the older name.
    """
    cloud = os.getenv("GOOGLE_GENAI_USE_ENTERPRISE") or os.getenv("GOOGLE_GENAI_USE_VERTEXAI") or ""
    if cloud.lower() in _TRUE:
        project = os.getenv("GOOGLE_CLOUD_PROJECT")
        if not project:
            _FAILURES["gemini"] = "Google Cloud login is on but GOOGLE_CLOUD_PROJECT is not set"
            return None
        location = os.getenv("GOOGLE_CLOUD_LOCATION") or "global"
        return f"Google Cloud login (project {project}, location {location})"
    if os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY"):
        return "API key"
    return None


def investigator_model() -> tuple[Any, str]:
    """The model the investigator runs on, and a description of the choice."""
    route = gemini_route()
    if route is not None:
        model = gemini_model_id()
        return model, f"gemini:{model} via {route}"
    from .scripted import ScriptedInvestigator

    why = _FAILURES.get("gemini", "no Gemini credentials")
    return ScriptedInvestigator(), f"offline scripted investigator ({why})"


def get_narrator() -> Narrator:
    if gemini_route() is not None:
        try:
            from .gemini import GeminiNarrator

            return GeminiNarrator()
        except Exception as exc:  # the adapter is optional; record why it is not live
            _FAILURES["narrator"] = f"{type(exc).__name__}: {exc}"
    return TemplateNarrator()


def get_gate() -> Gate:
    if os.getenv("TYPESAFE_API_KEY"):
        try:
            from .jev import JevGate

            return JevGate()
        except Exception as exc:  # the adapter is optional; record why it is not live
            _FAILURES["gate"] = f"{type(exc).__name__}: {exc}"
    return RuleGate()


def _investigator_name() -> str:
    route = gemini_route()
    if route is not None:
        return f"gemini:{gemini_model_id()} via {route}"
    return "offline-scripted"


def describe() -> dict[str, str]:
    out = {
        "investigator": _investigator_name(),
        "narrator": get_narrator().name,
        "gate": get_gate().name,
    }
    for role, why in _FAILURES.items():
        out[f"{role}_not_live"] = why
    return out
