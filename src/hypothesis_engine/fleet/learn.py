"""Turn a finished case into a lesson: what Crux said, what the technician found.

The ReasoningBank step (memory.py): a confirmed success becomes a strategy, a
confirmed miss becomes a pitfall. A model words the lesson when one is on
(Gemini, else a local model), templates otherwise; either way the lesson keeps
the case ids it came from and the name of the person who confirmed it.
"""

from __future__ import annotations

import json
import os

from .memory import Lesson

PROMPT = """A maintenance case has just been closed. Write ONE reusable lesson
for the next case on the same kind of machine, in plain words. No site names,
serial numbers or people. "when" describes the situation in general terms;
"do" is what to do or check; "avoid" is the mistake to avoid (empty if the
prediction was right).
Case: {case}
Return JSON: {{"title": "...", "when": "...", "do": "...", "avoid": "..."}}"""

_SCHEMA = {
    "type": "object",
    "properties": {k: {"type": "string"} for k in ("title", "when", "do", "avoid")},
    "required": ["title", "when", "do", "avoid"],
}


def _template(case: dict, found: str, right: bool) -> dict[str, str]:
    said = case["said"]
    if right:
        return {
            "title": f"Confirmed: {said}",
            "when": case["situation"],
            "do": f"Act on it: the technician found {found}.",
            "avoid": "",
        }
    return {
        "title": f"Missed: Crux said {said}; it was {found}",
        "when": case["situation"],
        "do": f"In this situation also check for {found} before trusting the call.",
        "avoid": f"Taking '{said}' at face value here.",
    }


def _worded(case: dict) -> dict[str, str] | None:
    prompt = PROMPT.format(case=json.dumps(case))
    try:
        if os.getenv("GOOGLE_API_KEY") or os.getenv("GOOGLE_GENAI_USE_VERTEXAI"):
            from google import genai  # type: ignore
            from google.genai import types  # type: ignore

            r = genai.Client().models.generate_content(
                model=os.getenv("GEMINI_MODEL", "gemini-3.1-pro"),
                contents=[prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json", response_schema=_SCHEMA
                ),
            )
            return json.loads(r.text or "{}")
        if os.getenv("OLLAMA_MODEL"):
            from ..agents import ollama

            if ollama.available():
                return json.loads(ollama.chat(prompt, schema=_SCHEMA))
    except Exception:  # a failed model must not lose the lesson
        return None
    return None


def lesson_from_outcome(
    *,
    machine_type: str,
    case_id: str,
    situation: str,
    said: str,
    found: str,
    right: bool,
    confirmed_by: str,
    source: str = "this site",
    use_model: bool = True,
) -> Lesson:
    case = {"situation": situation, "said": said, "found": found, "right": right}
    words = (_worded(case) if use_model else None) or _template(case, found, right)
    return Lesson(
        machine_type=machine_type,
        title=words["title"].strip(),
        when=words["when"].strip() or situation,
        do=words["do"].strip(),
        avoid=""
        if right
        else (words.get("avoid", "").strip() or f"Taking '{said}' at face value."),
        outcome="success" if right else "failure",
        source=source,
        cases=(case_id,),
        confirmed_by=confirmed_by,
    )
