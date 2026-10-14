"""Three plain sentences about one "as of" moment, from numbers the views already hold.

The facts are sentences built here from the views (BigQuery's or the
stand-in's). Gemini only rewrites them for a planner. A reply that states a
number not among the facts is dropped and the facts themselves stand in, the
rule the report writer follows (agents/report.py). The text is saved with the
snapshot, so a page view never calls Gemini.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

import numpy as np

from ..agents.factory import gemini_model_id, gemini_route, not_live
from . import views

Get = Callable[[str], dict[str, Any] | None]

PROMPT = """You write for a maintenance planner at a metro depot or a factory.
Write exactly three short sentences, each under 25 words, from the facts below.
Pick the facts that matter most to a planner and leave the rest out.
Rules: use only these facts; copy every number exactly as written; add no other
number; say what the readings show, never why (no diagnosis); no jargon, no
lists, no headings.

Facts:
"""

TIMEOUT_S = 60
#: Room for the reply after the model thinks: with 1,024 the reply was cut off
#: mid-sentence (14 Oct 2026), the failure agents/report.py fixed the same way.
MAX_TOKENS = 4096
THINKING_LEVEL = "low"

_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")


def _mean(xs: list[float | None]) -> float | None:
    x = np.array([v for v in xs if v is not None], dtype=float)
    return float(x.mean()) if len(x) else None


def _max(xs: list[float | None]) -> float | None:
    x = np.array([v for v in xs if v is not None], dtype=float)
    return float(x.max()) if len(x) else None


def _r(x: float | None, digits: int = 1) -> str:
    return "n/a" if x is None else f"{x:.{digits}f}"


def facts(source: str, get: Get) -> list[str]:
    """Sentences, each carrying numbers straight from a view."""
    out: list[str] = []
    if source == "metro":
        fc = get("forecast-day")
        if fc:
            by = {s["id"]: s for s in fc["signals"]}
            ld, mc = by["loaded"], by["motor_current"]
            exp, act = _mean(ld["forecast"]["p50"]), _mean(ld["actual"]["v"])
            out.append(
                f"Over the next day {fc['made']['model']} expected the compressor to run loaded "
                f"{_r(exp)}% of the time; the replay shows it ran loaded {_r(act)}%."
            )
            out.append(
                f"Expected peak motor current over that day: {_r(_max(mc['forecast']['p50']))} A "
                f"(upper edge {_r(_max(mc['forecast']['hi']))} A); the highest reading was "
                f"{_r(_max(mc['actual']['v']))} A."
            )
    an = get("anomalies")
    if an:
        per = ", ".join(f"{s['name'].lower()} {len(s['flagged'])}" for s in an["signals"])
        days = "the last week of the run" if an["relative"] else "the week checked"
        line = f"{an['flagged']} readings in {days} fell outside the expected band ({per})"
        if an.get("flagged_after_as_of") is not None:
            line += f"; {an['flagged_after_as_of']} of them came after the moment looked from"
        out.append(line + ".")
    ch = get("changes") if source == "metro" else None
    if ch and ch["rows"]:
        top = ch["rows"][0]
        out.append(
            f"Against the normal week, the loaded share while running changed most in "
            f"{top['label']}: {_r(top['test'])}% against {_r(top['control'])}%; over the whole "
            f"week {_r(ch['overall']['test'])}% against {_r(ch['overall']['control'])}%."
        )
    bd = get("breakdown") if source == "metro" else None
    if bd:
        ld = next(s for s in bd["signals"] if s["id"] == "loaded")
        if ld["step_list"]:
            big = max(ld["step_list"], key=lambda s: abs(s["size"] or 0))
            out.append(
                f"The largest step change the two-week model found in the loaded share was "
                f"{_r(big['size'])} points."
            )
    return out


def _allowed(fact_lines: list[str]) -> set[str]:
    return {n.replace(",", ".") for line in fact_lines for n in _NUMBER.findall(line)}


def checked(reply: str, fact_lines: list[str]) -> bool:
    """Every number in the reply is one the facts state, and the reply is finished."""
    allowed = _allowed(fact_lines)
    whole = reply.rstrip().endswith((".", "!", "?"))
    return whole and all(n.replace(",", ".") in allowed for n in _NUMBER.findall(reply))


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s.strip()]


class GeminiWriter:
    def __init__(self) -> None:
        from google import genai  # type: ignore
        from google.genai import types  # type: ignore

        self.model = gemini_model_id()
        self.name = f"gemini:{self.model}"
        self._client = genai.Client(http_options=types.HttpOptions(timeout=TIMEOUT_S * 1000))

    def __call__(self, fact_lines: list[str]) -> str:
        from google.genai import types  # type: ignore

        response = self._client.models.generate_content(
            model=self.model,
            contents=[PROMPT + "\n".join(f"- {f}" for f in fact_lines)],
            config=types.GenerateContentConfig(
                max_output_tokens=MAX_TOKENS,
                thinking_config=types.ThinkingConfig(thinking_level=THINKING_LEVEL),
            ),
        )
        return (response.text or "").strip()


Writer = Callable[[list[str]], str]


def default_writer() -> tuple[Writer | None, str]:
    if gemini_route() is None:
        return None, "template (no Gemini login)"
    try:
        w = GeminiWriter()
        return w, w.name
    except Exception as exc:  # noqa: BLE001 - any failure to start falls back
        not_live("series_writer", exc)
        return None, f"template ({type(exc).__name__})"


def summarise(
    source: str, preset_id: str, get: Get, engine: str, writer: Writer | None, writer_name: str
) -> dict[str, Any]:
    fact_lines = facts(source, get)
    text = " ".join(fact_lines[:3])
    used = "template"
    if writer is not None and fact_lines:
        try:
            reply = writer(fact_lines)
            if reply and checked(reply, fact_lines):
                text, used = reply, writer_name
            else:
                used = (
                    "template (Gemini's reply stated a number not in the facts, or stopped short)"
                )
        except Exception as exc:  # noqa: BLE001 - the template stands in
            not_live("series_writer", exc)
            used = f"template ({type(exc).__name__})"
    elif writer is None:
        used = writer_name
    made = views.Made(
        engine,
        used,
        "Gemini" if used.startswith("gemini") else "none",
        "",
        {"facts": len(fact_lines)},
    )
    return {
        "source": source,
        "preset": preset_id,
        "view": "summary",
        "text": text,
        "sentences": _sentences(text),
        "facts": fact_lines,
        "writer": used,
        "made": made.to_dict(),
    }
