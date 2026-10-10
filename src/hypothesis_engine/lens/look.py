"""What a vision model says about the scanned machine: what it is and where to measure.

One still goes to the model, which returns the kind of machine, any nameplate
text it can read, and a box around the housing that would shake (a motor body
or bearing housing, never spinning parts). The physics measures motion inside
that box. Visible trouble (a leak, a thrown belt) is checked separately with
the CCTV camera's look-and-confirm (`ticket.camera.inspect`).

Everything here is a reading for the technician to confirm: nameplate numbers
are shown, never used, until a person accepts them, and the box can be moved.
Nothing here moves a belief.

Gemini Robotics-ER 2 when a Gemini key is set (its documented boxes are
[y, x, y2, x2] in 0..1000), a local model through Ollama otherwise, and no look
at all offline, in which case the person draws the box.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, replace

from ..ticket import camera
from .motion import Box

PROMPT = """This is one frame from a phone video of a machine, taken to check how it is running.
1. machine_type: what kind of machine this is, in a few words.
2. nameplate_text: copy any text you can read on a nameplate or label exactly as
   written; empty if none is legible. Never fill in a number you cannot read.
3. box: a bounding box around the stationary housing that would shake if the
   machine were faulty: a motor body or a bearing housing. Not spinning parts,
   blades, belts or guards. Coordinates normalised to 0-1000, x across, y down.
4. box_label: what the box contains."""

_SCHEMA = {
    "type": "object",
    "properties": {
        "machine_type": {"type": "string"},
        "nameplate_text": {"type": "string"},
        "box": {
            "type": "object",
            "properties": {k: {"type": "number"} for k in ("x0", "y0", "x1", "y1")},
            "required": ["x0", "y0", "x1", "y1"],
        },
        "box_label": {"type": "string"},
    },
    "required": ["machine_type", "nameplate_text", "box", "box_label"],
}

#: Boxes smaller than this fraction of a side are too small to track.
MIN_BOX = 0.05


@dataclass(frozen=True)
class Identity:
    machine_type: str = ""
    nameplate_text: str = ""
    box: Box | None = None
    box_label: str = ""
    by: str = "nobody"
    note: str = ""


def box_from(b: dict) -> Box | None:
    """A model's 0..1000 box as fractions, or None if it is not a usable box."""
    try:
        x0, y0, x1, y1 = (float(b[k]) / 1000.0 for k in ("x0", "y0", "x1", "y1"))
    except (KeyError, TypeError, ValueError):
        return None
    x0, x1 = sorted((max(0.0, min(1.0, x0)), max(0.0, min(1.0, x1))))
    y0, y1 = sorted((max(0.0, min(1.0, y0)), max(0.0, min(1.0, y1))))
    if x1 - x0 < MIN_BOX or y1 - y0 < MIN_BOX:
        return None
    return Box(x0, y0, x1 - x0, y1 - y0)


def _identity(reply: dict, by: str) -> Identity:
    return Identity(
        str(reply.get("machine_type", "")).strip(),
        str(reply.get("nameplate_text", "")).strip(),
        box_from(reply.get("box") or {}),
        str(reply.get("box_label", "")).strip(),
        by,
    )


READ_AGAIN = """Look at this image again, carefully. Someone said a nameplate or label in it reads:
"{text}"
Is that exact text plainly legible in this image, letter by letter? Answer no if the
text is too small, blurred, partly hidden or only guessed from what such plates usually say."""

_LEGIBLE = {
    "type": "object",
    "properties": {"legible": {"type": "boolean"}},
    "required": ["legible"],
}


def _gemini(prompt: str, schema: dict, still: bytes) -> tuple[dict, str]:  # pragma: no cover
    from google import genai  # type: ignore
    from google.genai import types  # type: ignore

    model = os.getenv("GEMINI_LENS_MODEL", "gemini-robotics-er-2-preview")
    response = genai.Client().models.generate_content(
        model=model,
        contents=[types.Part.from_bytes(data=still, mime_type="image/jpeg"), prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json", response_schema=schema, temperature=0.0
        ),
    )
    return json.loads(response.text or "{}"), f"gemini:{model}"


def _local(prompt: str, schema: dict, still: bytes) -> tuple[dict, str]:
    from ..agents import ollama

    reply = ollama.chat(prompt, schema=schema, images=[still], temperature=0.0)
    return json.loads(reply), f"ollama:{ollama.model()}"


def _read(ask, still: bytes) -> Identity:  # noqa: ANN001 - one of the two askers above
    """Identify, then keep the nameplate text only if a second look can read it too.

    On 7 Oct 2026 a local 8B model wrote out a whole nameplate ("MODEL: 2000
    VOLTS: 220V ...") for a video still where no text is legible, and on a
    second, focused question said that text was not legible; on the full photo
    it confirmed the real "ABB" badge. So the reading stands only if it survives.
    """
    reply, by = ask(PROMPT, _SCHEMA, still)
    who = _identity(reply, by)
    if not who.nameplate_text:
        return who
    again, _ = ask(READ_AGAIN.format(text=who.nameplate_text), _LEGIBLE, still)
    if again.get("legible") is True:
        return who
    return replace(
        who,
        nameplate_text="",
        note="A first reading of the nameplate was not confirmed on a second look, left out.",
    )


def identify(still: bytes) -> Identity:
    """Gemini, else a local model, else nobody (the person draws the box)."""
    tried = []
    if os.getenv("GOOGLE_API_KEY") or os.getenv("GOOGLE_GENAI_USE_VERTEXAI"):
        try:
            return _read(_gemini, still)
        except Exception as e:  # pragma: no cover - adapter is optional
            tried.append(f"Gemini failed ({type(e).__name__})")
    if os.getenv("OLLAMA_MODEL"):
        from ..agents import ollama

        if ollama.available():
            try:
                return _read(_local, still)
            except Exception as e:  # a failed look must not lose the scan
                tried.append(f"local model failed ({type(e).__name__})")
    note = "; ".join(tried) or "No model is on: draw the box around the machine by hand."
    return Identity(note=note)


def visible(
    still: bytes, context: str, reference: bytes | None = None, reference_label: str = ""
) -> camera.CameraLook:
    """The checklist on the still, kept only where a cropped second look confirms it.

    `reference` is the middle still of the scan a person marked as this machine's
    normal one; the model then sees it beside the new still.
    """
    s = camera.Still("lens", "phone", still, "image/jpeg", "")
    ref = (
        camera.Still("lens", reference_label or "normal scan", reference, "image/jpeg", "")
        if reference
        else None
    )
    return camera.inspect(s, context, reference=ref, use_registry=False)
