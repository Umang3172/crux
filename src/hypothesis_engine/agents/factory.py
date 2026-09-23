"""Pick the best available implementation for each model role.

Order of preference, per role:

    Narrator : Gemini (GOOGLE_API_KEY)     -> template
    Gate     : Jev (TYPESAFE_API_KEY)      -> rules

Never raises because a key is missing. `describe()` tells you what you are
actually running, which is the first thing to put in a demo video.
"""

from __future__ import annotations

import os

from .offline import RuleGate, TemplateNarrator
from .protocols import Gate, Narrator


def get_narrator() -> Narrator:
    if os.getenv("GOOGLE_API_KEY") or os.getenv("GOOGLE_GENAI_USE_VERTEXAI"):
        try:
            from .gemini import GeminiNarrator

            return GeminiNarrator()
        except Exception:  # pragma: no cover - adapter is optional
            pass
    return TemplateNarrator()


def get_gate() -> Gate:
    if os.getenv("TYPESAFE_API_KEY"):
        try:
            from .jev import JevGate

            return JevGate()
        except Exception:  # pragma: no cover - adapter is optional
            pass
    return RuleGate()


def describe() -> dict[str, str]:
    return {"narrator": get_narrator().name, "gate": get_gate().name}
