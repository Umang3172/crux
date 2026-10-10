"""A look through the CCTV camera that covers a machine, for the repair ticket.

When the alarm fires, the ticket asks the camera registry for a still of that
machine and an inspector looks at it for visible trouble: a leak, smoke, oil on
the floor, a loose guard, a thrown belt. What it sees goes into the ticket as
unconfirmed, for the technician to check. It never reaches the investigation:
a camera finding does not move a belief.

Cameras are listed per machine in `data/cameras.json`:

    {"ims/test2": {"kind": "file", "path": "data/cameras/ims.jpg", "label": "Bay 2"},
     "xjtu/35Hz12kN/Bearing1_1": {"kind": "http", "url": "http://cam-4/snapshot.jpg"}}

`file` serves a saved still (demos, tests); `http` fetches the JPEG snapshot that
most IP cameras expose. Without Gemini the still is attached unread, and the
ticket says nobody has looked at it yet.
"""

from __future__ import annotations

import json
import os
import urllib.request
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

from ..agents.factory import gemini_model_id, gemini_route, not_live
from ..forecast.runs import DATA_ROOT

REGISTRY = DATA_ROOT / "cameras.json"
SNAPSHOT_TIMEOUT_S = 5.0


@dataclass(frozen=True)
class Still:
    machine: str
    camera: str  # the label a technician knows the camera by
    image: bytes
    mime: str
    taken_at: str  # ISO time the still was taken (or read)


@dataclass(frozen=True)
class Finding:
    what: str
    where: str
    confidence: float  # the inspector's own, 0..1
    hazard: bool = False  # someone could get hurt: escalate before anyone works


@dataclass
class CameraLook:
    camera: str
    taken_at: str
    findings: list[Finding] = field(default_factory=list)
    inspected_by: str = "nobody"
    note: str = ""


class Inspector(Protocol):
    name: str

    def look(self, still: Still, context: str) -> list[Finding]: ...


def _mime(path: Path) -> str:
    return "image/png" if path.suffix.lower() == ".png" else "image/jpeg"


def load_registry(path: Path | None = None) -> dict[str, dict]:
    p = path if path is not None else REGISTRY
    return json.loads(p.read_text()) if p.exists() else {}


def snapshot(machine: str, registry: dict[str, dict] | None = None) -> Still | None:
    """A still from the camera covering `machine`, or None if none does or it fails."""
    entry = (registry if registry is not None else load_registry()).get(machine)
    if not entry:
        return None
    now = datetime.now(UTC).isoformat(timespec="seconds")
    label = entry.get("label", machine)
    try:
        if entry["kind"] == "file":
            path = Path(entry["path"])
            if not path.is_absolute():
                path = DATA_ROOT.parent / path
            return Still(machine, label, path.read_bytes(), _mime(path), now)
        if entry["kind"] == "http":
            with urllib.request.urlopen(entry["url"], timeout=SNAPSHOT_TIMEOUT_S) as r:
                mime = r.headers.get_content_type() or "image/jpeg"
                return Still(machine, label, r.read(), mime, now)
    except (OSError, KeyError, ValueError):
        return None
    return None


class NoInspector:
    """The offline path: the still is attached, and the ticket says it is unread."""

    name = "offline"

    def look(self, still: Still, context: str) -> list[Finding]:
        return []


PROMPT = """You are looking at one CCTV still of an industrial machine whose
vibration monitor has just raised an alarm. Context: {context}
Report only problems that are plainly visible in this image: a liquid leak or
oil or water on the floor, smoke, scorch marks or discolouration, a guard that
is missing or hanging off, a belt that is off its pulley or torn, debris
against moving parts, or a person in danger. Do not report anything you would
have to assume, such as loose bolts, wear, misalignment or internal damage:
those cannot be seen in a photo. Most stills show nothing wrong; then return
an empty list. Confidence is how sure you are that the problem is really in
the image. Set hazard only if someone could be hurt."""

_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "what": {"type": "string"},
            "where": {"type": "string"},
            "confidence": {"type": "number"},
            "hazard": {"type": "boolean"},
        },
        "required": ["what", "where", "confidence", "hazard"],
    },
}


class GeminiInspector:
    """Gemini reads the still and returns typed findings (structured output)."""

    def __init__(self) -> None:
        from google import genai  # type: ignore

        self.model = gemini_model_id("camera_look")
        self.name = f"gemini:{self.model}"
        self._client = genai.Client()

    def confirm(self, still: Still, finding: Finding) -> bool:
        from google.genai import types  # type: ignore

        response = self._client.models.generate_content(
            model=self.model,
            contents=[
                types.Part.from_bytes(data=still.image, mime_type=still.mime),
                CONFIRM.format(what=finding.what, where=finding.where),
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json", response_schema=_YES_NO
            ),
        )
        return bool(json.loads(response.text or "{}").get("visible", False))

    def look(self, still: Still, context: str) -> list[Finding]:
        from google.genai import types  # type: ignore

        response = self._client.models.generate_content(
            model=self.model,
            contents=[
                types.Part.from_bytes(data=still.image, mime_type=still.mime),
                PROMPT.format(context=context),
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json", response_schema=_SCHEMA
            ),
        )
        items = json.loads(response.text or "[]")
        return [
            Finding(
                str(i["what"]),
                str(i["where"]),
                max(0.0, min(1.0, float(i["confidence"]))),
                bool(i["hazard"]),
            )
            for i in items
        ]


CONFIRM = """Look at this CCTV still again, carefully. Someone said it shows: {what},
at {where}. Is that plainly visible in this image, beyond doubt? Reflections,
shadows, shiny floors, cables and normal parts of the machine do not count, and
"nothing wrong" is not a finding. Answer yes only if you can point to it."""

_YES_NO = {
    "type": "object",
    "properties": {"visible": {"type": "boolean"}, "sure": {"type": "number"}},
    "required": ["visible", "sure"],
}


class LocalInspector:
    """The same look on a local vision model through Ollama (Gemma 4 reads images)."""

    def __init__(self) -> None:
        from ..agents import ollama

        if not ollama.available():
            raise RuntimeError("no local model")
        self._ollama = ollama
        self.name = f"ollama:{ollama.model()}"

    def look(self, still: Still, context: str) -> list[Finding]:
        schema = {"type": "object", "properties": {"findings": _SCHEMA}, "required": ["findings"]}
        reply = self._ollama.chat(
            PROMPT.format(context=context), schema=schema, images=[still.image]
        )
        return [
            Finding(
                str(i["what"]),
                str(i["where"]),
                max(0.0, min(1.0, float(i["confidence"]))),
                bool(i["hazard"]),
            )
            for i in json.loads(reply)["findings"]
        ]

    def confirm(self, still: Still, finding: Finding) -> bool:
        reply = self._ollama.chat(
            CONFIRM.format(what=finding.what, where=finding.where),
            schema=_YES_NO,
            images=[still.image],
        )
        return bool(json.loads(reply)["visible"])


def get_inspector() -> Inspector:
    """Gemini, else a local vision model if OLLAMA_MODEL is set and answering, else nobody."""
    if gemini_route() is not None:
        try:
            return GeminiInspector()
        except Exception as exc:  # the adapter is optional; say why it is not live
            not_live("camera_look", exc)
    if os.getenv("OLLAMA_MODEL"):
        try:
            return LocalInspector()
        except Exception as exc:  # server down or model missing
            not_live("camera_look_local", exc)
    return NoInspector()


def inspect(still: Still, context: str, inspector: Inspector | None = None) -> CameraLook:
    """Look once, then keep only what a focused second look confirms.

    Vision models report things that are not there (on 6 Oct 2026 a local 8B
    model saw a leak in a shiny floor). A finding goes on the ticket only if a
    yes/no question about that one thing, asked fresh, says it is plainly visible.
    """
    who = inspector or get_inspector()
    try:
        first = who.look(still, context)
        confirm = getattr(who, "confirm", None)
        findings = [f for f in first if confirm is None or confirm(still, f)]
        if who.name == "offline":
            note = "No model is on: nobody has looked at this still yet."
        elif len(findings) < len(first):
            note = f"{len(first) - len(findings)} first-look finding(s) not confirmed on a second look, left out."
        else:
            note = ""
    except Exception as e:  # a failed look must not lose the still
        findings = []
        note = f"The camera check failed ({type(e).__name__}); look at the still by eye."
    return CameraLook(still.camera, still.taken_at, findings, who.name, note)
