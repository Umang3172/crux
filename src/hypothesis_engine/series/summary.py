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
from .settings import WINDOW_BEFORE_H

Get = Callable[[str], dict[str, Any] | None]

PROMPT = """You write for a maintenance planner at a metro depot or a factory.
Write exactly three short sentences, each under 25 words, from the facts below.
Pick the facts that matter most to a planner and leave the rest out.
Rules: use only these facts; copy every number exactly as written; add no other
number; when a fact sets a number beside the normal week's, keep both in the
same sentence; when a fact says a leak was reported, include it; say what the
readings show, never why (no diagnosis); no jargon, no lists, no headings.

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


def _hours(seconds: float) -> str:
    h = seconds / 3600
    return f"{h:.0f}" if abs(h - round(h)) < 0.05 else f"{h:.1f}"


def _loaded(fc: dict[str, Any]) -> tuple[float | None, float | None]:
    ld = next(s for s in fc["signals"] if s["id"] == "loaded")
    return _mean(ld["forecast"]["p50"]), _mean(ld["actual"]["v"])


def _peaks(fc: dict[str, Any]) -> tuple[float | None, float | None, float | None]:
    """Motor current over the day: the forecast's peak, its upper edge's, and the highest reading."""
    mc = next(s for s in fc["signals"] if s["id"] == "motor_current")
    return _max(mc["forecast"]["p50"]), _max(mc["forecast"]["hi"]), _max(mc["actual"]["v"])


def _largest_step(bd: dict[str, Any]) -> float | None:
    ld = next(s for s in bd["signals"] if s["id"] == "loaded")
    if not ld["step_list"]:
        return None
    return max(ld["step_list"], key=lambda s: abs(s["size"] or 0))["size"]


def facts(source: str, get: Get, normal: Get | None = None) -> list[str]:
    """Sentences, each carrying numbers straight from a view.

    `normal` reads the normal week's views: a number for a leak week is stated
    beside the normal week's, because on its own it reads as more than it is
    (the next-day forecast also misses on a normal day, and a normal week also
    has readings outside the band).
    """
    out: list[str] = []
    later: list[str] = []
    if source == "metro":
        fc = get("forecast-day")
        if fc:
            exp, act = _loaded(fc)
            line = (
                f"Over the next day {fc['made']['model']} expected the compressor to run loaded "
                f"{_r(exp)}% of the time and it ran loaded {_r(act)}%"
            )
            nfc = normal("forecast-day") if normal else None
            if nfc:
                nexp, nact = _loaded(nfc)
                line += (
                    f"; in the normal week the same forecast expected {_r(nexp)}% and it ran "
                    f"loaded {_r(nact)}%"
                )
            out.append(line + ".")
            leak = next((f for f in fc["failures"] if f["start"] >= fc["as_of"]), None)
            if leak:
                out.append(
                    f"The operator reported an air leak {_hours(leak['start'] - fc['as_of'])} "
                    "hours after the moment looked from, inside that day."
                )
            mc = _peaks(fc)
            line = (
                f"Expected peak motor current over that day: {_r(mc[0])} A "
                f"(upper edge {_r(mc[1])} A); the highest reading was {_r(mc[2])} A"
            )
            if nfc:
                nmc = _peaks(nfc)
                line += f"; in the normal week, expected {_r(nmc[0])} A and highest {_r(nmc[2])} A"
            later.append(line + ".")
    an = get("anomalies")
    if an and not an["relative"] and "counted" in an:
        days = WINDOW_BEFORE_H // 24
        before = an["counted"] - (an["counted_after_as_of"] or 0)
        line = (
            f"While the motor ran, {before} readings fell outside the expected band in the "
            f"{days} days before the moment looked from and {an['counted_after_as_of']} in the day after"
        )
        nan = normal("anomalies") if normal else None
        if nan and "counted" in nan:
            t = views.tally(nan)
            line += f"; in the normal week, {t['before']} and {t['after']}"
        out.append(line + ".")
        if an["not_counted_off"]:
            later.append(
                f"{an['not_counted_off']} more readings fell outside the band while the motor "
                "was off, and are not counted."
            )
    elif an:
        per = ", ".join(f"{s['name'].lower()} {len(s['flagged'])}" for s in an["signals"])
        days = "the last week of the run" if an["relative"] else "the week checked"
        out.append(f"{an['flagged']} readings in {days} fell outside the expected band ({per}).")
    ch = get("changes") if source == "metro" else None
    if ch and ch["rows"]:
        top = ch["rows"][0]
        out.append(
            f"Against the normal week, the loaded share while running changed most in "
            f"{top['label']}: {_r(top['test'])}% against {_r(top['control'])}%; over the whole "
            f"week {_r(ch['overall']['test'])}% against {_r(ch['overall']['control'])}%."
        )
    bd = get("breakdown") if source == "metro" else None
    big = _largest_step(bd) if bd else None
    if big is not None:
        line = (
            f"The largest step change the two-week model found in the loaded share was "
            f"{_r(big)} points"
        )
        nbd = normal("breakdown") if normal else None
        nbig = _largest_step(nbd) if nbd else None
        if nbig is not None:
            line += f"; in the normal week, {_r(nbig)} points"
        later.append(line + ".")
    return out + later


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
    source: str,
    preset_id: str,
    get: Get,
    engine: str,
    writer: Writer | None,
    writer_name: str,
    normal: Get | None = None,
) -> dict[str, Any]:
    fact_lines = facts(source, get, normal)
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
