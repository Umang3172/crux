"""Pick the best available implementation for each model role.

Order of preference, per role:

    Investigator : Gemini (Google Cloud login, or an API key) -> scripted offline policy
    Report       : Gemini -> local model (OLLAMA_MODEL)        -> the engine's own lines
    Gate         : Jev (TYPESAFE_API_KEY)                      -> rules

Never raises because a credential is missing, and never hides why an adapter
is not live: `describe()` says what is actually running and, when a live
adapter failed to start, why. That is the first thing to put in a demo video.

Every place that calls Gemini asks here whether it is on (`gemini_route`) and
which model to use (`gemini_model_id`), and reports here when it could not
(`not_live`). One login therefore turns all of them on, and none fails quietly.
"""

from __future__ import annotations

import os
from typing import Any

from .offline import RuleGate
from .protocols import Gate

#: The Gemini model used when `GEMINI_MODEL` is not set. Stable, supports function
#: calling, structured output and thinking, with a free tier (ai.google.dev model
#: list, checked 2 Oct 2026). Model ids change; set `GEMINI_MODEL` to move.
DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"

# Why a live adapter is not running, per role, for `describe()`.
_FAILURES: dict[str, str] = {}

_TRUE = {"1", "true", "yes"}


#: The model Lens uses to box a machine and read its nameplate: the robotics
#: model, which returns points and boxes. Set `GEMINI_LENS_MODEL` to move.
DEFAULT_LENS_MODEL = "gemini-robotics-er-2-preview"

#: The model the camera look uses to inspect a still. Gemini 3 Flash with code
#: execution is what Google calls Agentic Vision: the model crops and zooms into
#: the image in Python before answering ("Introducing Agentic Vision in Gemini 3
#: Flash", blog.google, 27 Jan 2026). Set `GEMINI_VISION_MODEL` to move.
DEFAULT_VISION_MODEL = "gemini-3-flash-preview"

#: Call sites with a model setting of their own, and a default of their own,
#: because each needs a model that suits the job: one that can run code on an
#: image for the camera look, the robotics model for Lens.
_ROLE_SETTING = {"camera_look": "GEMINI_VISION_MODEL", "lens_look": "GEMINI_LENS_MODEL"}
_ROLE_DEFAULT = {"camera_look": DEFAULT_VISION_MODEL, "lens_look": DEFAULT_LENS_MODEL}

#: Every place a model is called besides the investigator and the gate, by the
#: name `describe()` and the preflight show it under.
OTHER_ROLES = ("report_writer", "ticket_writer", "camera_look", "lens_look", "lesson_writer")

#: Call sites a deploy can switch off by setting, and the setting. The verdict's
#: explanation is one: the report is then the engine's own lines.
_SWITCH = {"report_writer": "CRUX_REPORT_MODEL"}


def switched_off(role: str) -> bool:
    """Whether a call site has been turned off by its own setting (`off`)."""
    return os.getenv(_SWITCH.get(role, ""), "").strip().lower() == "off"


def gemini_model_id(role: str | None = None) -> str:
    """The Gemini model for a call site: its own setting if it has one and it is
    set, else its own default if it has one, else `GEMINI_MODEL`, else the default."""
    own = os.getenv(_ROLE_SETTING.get(role or "", ""))
    if own:
        return own
    if role in _ROLE_DEFAULT:
        return _ROLE_DEFAULT[role]
    return os.getenv("GEMINI_MODEL") or DEFAULT_GEMINI_MODEL


def not_live(role: str, exc: BaseException) -> None:
    """Record why a call site fell back, for `describe()`. Falling back is fine;
    doing it without saying so is how a product ships with its model off."""
    _FAILURES[role] = f"{type(exc).__name__}: {exc}"[:300]


def provider(role: str) -> str:
    """What a call site would run on as things are configured: Gemini, a local
    model, or neither. Whether it answers is only known once it is used."""
    if switched_off(role):
        return f"off ({_SWITCH[role]}=off)"
    if gemini_route() is not None:
        return f"gemini:{gemini_model_id(role)}"
    if os.getenv("OLLAMA_MODEL"):
        return f"ollama:{os.environ['OLLAMA_MODEL']}"
    return "offline"


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
        "gate": get_gate().name,
    }
    out |= {role: provider(role) for role in OTHER_ROLES}
    for role, why in _FAILURES.items():
        out[f"{role}_not_live"] = why
    return out
