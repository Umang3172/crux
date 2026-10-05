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
List only things you can actually see that a maintenance technician should
check: leaks, oil or water on the floor, smoke, discolouration from heat, a
loose or missing guard, a thrown or frayed belt, debris, loose fasteners, or a
person in danger. Do not guess at internal faults you cannot see. If nothing is
visibly wrong, return an empty list. Set hazard only if someone could be hurt."""

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

        self.model = os.getenv("GEMINI_VISION_MODEL", os.getenv("GEMINI_MODEL", "gemini-3.1-pro"))
        self.name = f"gemini:{self.model}"
        self._client = genai.Client()

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


def get_inspector() -> Inspector:
    if os.getenv("GOOGLE_API_KEY") or os.getenv("GOOGLE_GENAI_USE_VERTEXAI"):
        try:
            return GeminiInspector()
        except Exception:  # pragma: no cover - adapter is optional
            pass
    return NoInspector()


def inspect(still: Still, context: str, inspector: Inspector | None = None) -> CameraLook:
    who = inspector or get_inspector()
    try:
        findings = who.look(still, context)
        note = (
            "" if who.name != "offline" else "Gemini is off: nobody has looked at this still yet."
        )
    except Exception as e:  # a failed look must not lose the still
        findings, note = (
            [],
            f"The camera check failed ({type(e).__name__}); look at the still by eye.",
        )
    return CameraLook(still.camera, still.taken_at, findings, who.name, note)
