"""A look at a still of a machine for plainly visible trouble, for the ticket and for Lens.

When the alarm fires, the ticket asks the camera registry for a still of that
machine; a Lens scan brings its own. An inspector then answers a fixed checklist
about it (a crack, a leak, rust, a damaged or thrown belt, heat marks, loose or
missing fasteners and guards, smoke), item by item, with a box around anything it
reports. What survives the checks below goes into the ticket or the scan as
unconfirmed, for the technician to check. It never reaches the investigation: a
camera finding does not move a belief.

The look runs in four steps:

1. **Quality gate** (`photo.quality`): a still that is too small, too dark, blown
   out or blurred is turned back with the measured reason; no model sees it.
2. **First look**: the whole checklist, with the machine's normal photo alongside
   when there is one, labelled "reference (normal)" and "now".
3. **Second look**: every item reported present is cropped around its box with
   margin (`photo.crop`) and asked about again, fresh, as a yes or no, with the
   same region of the reference. Only what this confirms is kept; how many were
   dropped is recorded.
4. A model that "cannot see" any item is treated like a failed gate: retake.

Cameras are listed per machine in `data/cameras.json`; `normal` names a still
of the machine in good condition, used as the reference:

    {"ims/test2": {"kind": "file", "path": "data/cameras/ims.jpg", "label": "Bay 2",
                   "normal": "data/cameras/ims_normal.jpg"},
     "xjtu/35Hz12kN/Bearing1_1": {"kind": "http", "url": "http://cam-4/snapshot.jpg"}}

`file` serves a saved still (demos, tests); `http` fetches the JPEG snapshot that
most IP cameras expose. Without a model the still is attached unread, and the
ticket says nobody has looked at it yet.
"""

from __future__ import annotations

import json
import os
import urllib.request
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

from ..forecast.runs import DATA_ROOT
from . import photo

REGISTRY = DATA_ROOT / "cameras.json"
SNAPSHOT_TIMEOUT_S = 5.0

#: The name an inspector carries when no model has looked. The ticket writer
#: (`ticket.draft.camera_sentence`) says "nobody has looked at it yet" on this
#: name, which is also true of a still the quality gate turned back.
NOBODY = "offline"

#: Gemini 3 Flash with code execution is what Google calls Agentic Vision: the
#: model crops and zooms into the image in Python before answering ("Introducing
#: Agentic Vision in Gemini 3 Flash", blog.google, 27 Jan 2026).
AGENTIC_VISION_MODEL = "gemini-3-flash-preview"

#: The checklist: item id, how a ticket names it, what counts as seeing it.
CHECKLIST: tuple[tuple[str, str, str], ...] = (
    (
        "crack",
        "Crack",
        "a visible crack or fracture in a casing, housing, weld, bracket, shaft or guard",
    ),
    (
        "leak",
        "Leak (oil, water or coolant)",
        "liquid escaping or pooled: drips, wet streaks, a puddle or oil-soaked dirt under the machine",
    ),
    (
        "corrosion",
        "Corrosion or rust",
        "rust-coloured or flaking metal, pitting, white or green deposits on metal",
    ),
    (
        "belt",
        "Belt damage or a thrown belt",
        "a drive belt that is frayed, cracked, torn, missing, slack or off its pulley",
    ),
    (
        "heat",
        "Discolouration or heat marks",
        "blued, browned or blackened metal or paint, scorch marks, melted plastic",
    ),
    (
        "loose",
        "Loose or missing fasteners or guards",
        "a bolt or nut visibly missing or backed out, a guard missing, open or hanging off",
    ),
    ("smoke", "Smoke", "smoke or haze rising from the machine"),
)
ITEMS = tuple(i for i, _, _ in CHECKLIST)
LABELS = {i: label for i, label, _ in CHECKLIST}
STATUSES = ("present", "absent", "unsure", "cannot_see")
SEVERITIES = ("none", "low", "medium", "high")
NEW = ("yes", "no", "no_reference")

#: Escalate before anyone works on the machine: smoke, or anything the model grades high.
HAZARD_ITEMS = ("smoke",)


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
    #: The checklist asks for no confidence number (severity carries the model's
    #: grading); kept at 0 so the ticket's number check has nothing to accept.
    confidence: float
    hazard: bool = False  # someone could get hurt: escalate before anyone works
    item: str = ""  # checklist id
    status: str = "present"  # present | absent | unsure | cannot_see
    severity: str = "none"  # low | medium | high when present
    box: tuple[int, int, int, int] | None = None  # [ymin, xmin, ymax, xmax], 0..1000
    evidence: str = ""  # one sentence of what is visible
    new_since_reference: str = "no_reference"  # yes | no | no_reference


@dataclass
class CameraLook:
    camera: str
    taken_at: str
    findings: list[Finding] = field(default_factory=list)  # kept after the second look
    inspected_by: str = "nobody"
    note: str = ""
    checklist: list[Finding] = field(default_factory=list)  # every first-look answer
    retake: str = ""  # why to take the photo again; "" when it was usable
    quality: dict[str, float | int | bool] = field(default_factory=dict)
    reference: str = ""  # the normal photo used, "" when none
    dropped: int = 0  # first-look "present" items the second look did not confirm
    zooms: int = 0  # code the model ran on the image (Agentic Vision), when it reports it


@dataclass(frozen=True)
class Second:
    """A second look's answer about one finding."""

    visible: bool
    new_since_reference: str = "no_reference"
    evidence: str = ""


class Inspector(Protocol):
    name: str

    def look(self, still: Still, context: str, reference: Still | None = None) -> list[Finding]: ...


def _mime(path: Path) -> str:
    return "image/png" if path.suffix.lower() == ".png" else "image/jpeg"


def load_registry(path: Path | None = None) -> dict[str, dict]:
    p = path if path is not None else REGISTRY
    return json.loads(p.read_text()) if p.exists() else {}


def _file(path_text: str) -> Path:
    path = Path(path_text)
    return path if path.is_absolute() else DATA_ROOT.parent / path


def snapshot(machine: str, registry: dict[str, dict] | None = None) -> Still | None:
    """A still from the camera covering `machine`, or None if none does or it fails."""
    entry = (registry if registry is not None else load_registry()).get(machine)
    if not entry:
        return None
    now = datetime.now(UTC).isoformat(timespec="seconds")
    label = entry.get("label", machine)
    try:
        if entry["kind"] == "file":
            path = _file(entry["path"])
            return Still(machine, label, path.read_bytes(), _mime(path), now)
        if entry["kind"] == "http":
            with urllib.request.urlopen(entry["url"], timeout=SNAPSHOT_TIMEOUT_S) as r:
                mime = r.headers.get_content_type() or "image/jpeg"
                return Still(machine, label, r.read(), mime, now)
    except (OSError, KeyError, ValueError):
        return None
    return None


def normal_still(machine: str, registry: dict[str, dict] | None = None) -> Still | None:
    """The registry's still of `machine` in normal condition, the reference, if one is listed."""
    entry = (registry if registry is not None else load_registry()).get(machine) or {}
    if not entry.get("normal"):
        return None
    path = _file(entry["normal"])
    try:
        image = path.read_bytes()
    except OSError:
        return None
    taken = datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat(timespec="seconds")
    label = f"{entry.get('label', machine)}, normal photo"
    return Still(machine, label, image, _mime(path), taken)


class NoInspector:
    """The offline path: the still is attached, and the ticket says it is unread."""

    name = NOBODY

    def look(self, still: Still, context: str, reference: Still | None = None) -> list[Finding]:
        return []


# ------------------------------------------------------------------ prompts

PROMPT = """You are checking one photo of an industrial machine for plainly visible trouble.
Context: {context}
{reference}
Answer every item of this checklist about the photo{now}:
{items}

For each item give:
- status: "present" only if you can point to it in the photo; "absent" if the place it
  would show is in view and it is not there; "unsure" if something might be it but you
  cannot tell; "cannot_see" if the photo does not show enough (too dark, blurred, too
  far, or that part of the machine is out of view).
- severity: "low", "medium" or "high" when present, "none" otherwise.
- box: [ymin, xmin, ymax, xmax] around what you see, each from 0 to 1000 of the image
  height or width; an empty list when not present.
- evidence: one short sentence on what is visible there.
- new_since_reference: {new}
Reflections, shadows, shiny or wet-looking floors, cables, labels, normal paint colour
and ordinary dirt are not findings. Do not report what you would have to assume (wear,
misalignment, internal damage): those cannot be seen in a photo. Most photos show
none of these."""

_WITH_REFERENCE = (
    "You get two photos of the same machine: the first is the REFERENCE, taken when it "
    "ran normally; the second is NOW. Judge only the NOW photo; use the reference to "
    "tell what has changed."
)
_NEW_WITH = '"yes" if it is not in the reference photo, "no" if the reference shows it too.'
_NEW_WITHOUT = '"no_reference" (there is no reference photo).'

CONFIRM = """This is a close-up crop of a photo of an industrial machine. Someone reported
here: {label}: "{evidence}".
{reference}Is that plainly visible in this crop, beyond doubt? Reflections, shadows, shiny
floors, cables, labels, dirt and normal parts of the machine do not count. Answer
visible: true only if you can point to it."""

_CONFIRM_WITH = (
    "The first image is the same region of a REFERENCE photo taken when the machine ran "
    "normally; the second is NOW. Judge the NOW crop, and say whether it is new since "
    "the reference.\n"
)


def checklist_prompt(context: str, with_reference: bool) -> str:
    items = "\n".join(f"- {i}: {label}: {what}" for i, label, what in CHECKLIST)
    return PROMPT.format(
        context=context or "none",
        reference=_WITH_REFERENCE if with_reference else "",
        now=" NOW" if with_reference else "",
        items=items,
        new=_NEW_WITH if with_reference else _NEW_WITHOUT,
    )


def _item_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "status": {"type": "string", "enum": list(STATUSES)},
            "severity": {"type": "string", "enum": list(SEVERITIES)},
            "box": {"type": "array", "items": {"type": "integer"}},
            "evidence": {"type": "string"},
            "new_since_reference": {"type": "string", "enum": list(NEW)},
        },
        "required": ["status", "severity", "box", "evidence", "new_since_reference"],
    }


#: One answer per item, by name, so no item can be skipped or repeated.
SCHEMA = {
    "type": "object",
    "properties": {i: _item_schema() for i in ITEMS},
    "required": list(ITEMS),
}

CONFIRM_SCHEMA = {
    "type": "object",
    "properties": {
        "visible": {"type": "boolean"},
        "new_since_reference": {"type": "string", "enum": list(NEW)},
        "evidence": {"type": "string"},
    },
    "required": ["visible", "new_since_reference", "evidence"],
}


def findings_from(reply: dict, with_reference: bool) -> list[Finding]:
    """The checklist answers as findings; anything malformed reads as "unsure"."""
    out = []
    for item in ITEMS:
        a = reply.get(item) if isinstance(reply.get(item), dict) else {}
        status = a.get("status") if a.get("status") in STATUSES else "unsure"
        severity = a.get("severity") if a.get("severity") in SEVERITIES else "none"
        new = a.get("new_since_reference")
        if not with_reference or new not in NEW:
            new = "no_reference"  # nothing to compare with, or no comparison given
        box = photo.parse_box(a.get("box")) if status == "present" else None
        evidence = str(a.get("evidence", "")).strip()
        out.append(
            Finding(
                what=LABELS[item],
                where=evidence or "see the box on the photo",
                confidence=0.0,
                hazard=status == "present" and (item in HAZARD_ITEMS or severity == "high"),
                item=item,
                status=status,
                severity=severity if status == "present" else "none",
                box=box,
                evidence=evidence,
                new_since_reference=new,
            )
        )
    return out


def second_from(reply: dict, with_reference: bool) -> Second:
    new = reply.get("new_since_reference")
    if not with_reference or new not in NEW:
        new = "no_reference"
    return Second(bool(reply.get("visible", False)), new, str(reply.get("evidence", "")).strip())


# ------------------------------------------------------------------ inspectors


class GeminiInspector:
    """Gemini 3 Flash with code execution (Agentic Vision): NOT RUN as of 10 Oct 2026.

    One request carries both photos, labelled, with the checklist schema as
    structured output; Gemini 3 accepts structured output together with code
    execution (ai.google.dev/gemini-api/docs/gemini-3, read 10 Oct 2026). Should a
    model refuse the pair, the answer is taken in two steps: the look with code
    execution in plain text, then that text written into the schema without tools.
    Temperature stays at the default 1.0, which the same guide asks for on Gemini 3.
    `GEMINI_AGENTIC_VISION=0` turns code execution off, to measure what it adds.
    """

    def __init__(self) -> None:
        from google import genai  # type: ignore

        self.model = os.getenv("GEMINI_VISION_MODEL", AGENTIC_VISION_MODEL)
        self.agentic = os.getenv("GEMINI_AGENTIC_VISION", "1") != "0"
        self.name = f"gemini:{self.model}" + ("+code" if self.agentic else "")
        self.zooms = 0
        self._client = genai.Client()

    def _contents(self, prompt: str, still: Still, reference: Still | None) -> list:
        from google.genai import types  # type: ignore

        parts: list = []
        if reference is not None:
            parts += [
                "Reference (normal):",
                types.Part.from_bytes(data=reference.image, mime_type=reference.mime),
                "Now:",
            ]
        parts += [types.Part.from_bytes(data=still.image, mime_type=still.mime), prompt]
        return parts

    def _json(self, response) -> dict:  # noqa: ANN001 - genai GenerateContentResponse
        """The last JSON text part; code and its output come before it."""
        parts = response.candidates[0].content.parts or []
        self.zooms += sum(1 for p in parts if getattr(p, "executable_code", None))
        texts = [
            p.text for p in parts if getattr(p, "text", None) and not getattr(p, "thought", False)
        ]
        for text in reversed(texts):
            try:
                return json.loads(text)
            except ValueError:
                continue
        return json.loads(response.text or "")

    def _ask(self, contents: list, schema: dict, tools: bool) -> dict:
        from google.genai import errors, types  # type: ignore

        code = [types.Tool(code_execution=types.ToolCodeExecution())] if tools else None
        config = types.GenerateContentConfig(
            response_mime_type="application/json", response_json_schema=schema, tools=code
        )
        try:
            response = self._client.models.generate_content(
                model=self.model, contents=contents, config=config
            )
            return self._json(response)
        except (errors.ClientError, ValueError):
            if not tools:
                raise
        free = self._client.models.generate_content(
            model=self.model,
            contents=contents + ["Answer in plain text, item by item."],
            config=types.GenerateContentConfig(tools=code),
        )
        self.zooms += sum(
            1
            for p in (free.candidates[0].content.parts or [])
            if getattr(p, "executable_code", None)
        )
        typed = self._client.models.generate_content(
            model=self.model,
            contents=[
                "Write this inspection into the JSON schema, changing nothing:\n"
                + (free.text or "")
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json", response_json_schema=schema
            ),
        )
        return json.loads(typed.text or "{}")

    def look(self, still: Still, context: str, reference: Still | None = None) -> list[Finding]:
        prompt = checklist_prompt(context, reference is not None)
        reply = self._ask(self._contents(prompt, still, reference), SCHEMA, self.agentic)
        return findings_from(reply, reference is not None)

    def confirm(self, crop: Still, finding: Finding, reference: Still | None = None) -> Second:
        prompt = CONFIRM.format(
            label=finding.what,
            evidence=finding.evidence,
            reference=_CONFIRM_WITH if reference is not None else "",
        )
        reply = self._ask(self._contents(prompt, crop, reference), CONFIRM_SCHEMA, False)
        return second_from(reply, reference is not None)


class LocalInspector:
    """The same checklist on a local vision model through Ollama (tested with Gemma 4).

    Ollama takes several images in one message and constrains the reply to the
    JSON schema; there is no code execution, so the crop for the second look is
    the deterministic stand-in for Agentic Vision's zoom.
    """

    def __init__(self) -> None:
        from ..agents import ollama

        if not ollama.available():
            raise RuntimeError("no local model")
        self._ollama = ollama
        self.name = f"ollama:{ollama.model()}"

    def _images(self, still: Still, reference: Still | None) -> list[bytes]:
        return [reference.image, still.image] if reference is not None else [still.image]

    def look(self, still: Still, context: str, reference: Still | None = None) -> list[Finding]:
        reply = self._ollama.chat(
            checklist_prompt(context, reference is not None),
            schema=SCHEMA,
            images=self._images(still, reference),
            temperature=0.0,
        )
        return findings_from(json.loads(reply), reference is not None)

    def confirm(self, crop: Still, finding: Finding, reference: Still | None = None) -> Second:
        prompt = CONFIRM.format(
            label=finding.what,
            evidence=finding.evidence,
            reference=_CONFIRM_WITH if reference is not None else "",
        )
        reply = self._ollama.chat(
            prompt, schema=CONFIRM_SCHEMA, images=self._images(crop, reference), temperature=0.0
        )
        return second_from(json.loads(reply), reference is not None)


def get_inspector() -> Inspector:
    """Gemini, else a local vision model if OLLAMA_MODEL is set and answering, else nobody."""
    if os.getenv("GOOGLE_API_KEY") or os.getenv("GOOGLE_GENAI_USE_VERTEXAI"):
        try:
            return GeminiInspector()
        except Exception:  # pragma: no cover - adapter is optional
            pass
    if os.getenv("OLLAMA_MODEL"):
        try:
            return LocalInspector()
        except Exception:  # pragma: no cover - server down or model missing
            pass
    return NoInspector()


# ------------------------------------------------------------------ the look


def _crop(still: Still, box: tuple[int, int, int, int] | None) -> Still:
    if box is None:
        return still
    return replace(still, image=photo.crop(still.image, box), mime="image/jpeg")


def inspect(
    still: Still,
    context: str,
    inspector: Inspector | None = None,
    reference: Still | None = None,
    use_registry: bool = True,
    second_look: bool = True,
) -> CameraLook:
    """Gate, look with the checklist, then keep only what a cropped second look confirms.

    Vision models report things that are not there (on 6 Oct 2026 a local 8B
    model saw a leak in a shiny floor). A finding is kept only if a yes/no
    question about that one thing, asked fresh on a crop around it, says it is
    plainly visible. `reference` is the machine's normal photo; when none is given,
    the camera registry's `normal` still for this machine is used if there is one.
    `second_look=False` keeps the first look as it is, for scoring what the second adds.
    """
    who = inspector or get_inspector()
    if reference is None and use_registry:
        reference = normal_still(still.machine)
    gate = photo.quality(still.image)
    look = CameraLook(
        still.camera,
        still.taken_at,
        inspected_by=who.name,
        quality=gate.as_dict(),
        reference=reference.camera if reference is not None else "",
    )
    if who.name == NOBODY:
        look.note = "No model is on: nobody has looked at this still yet."
        if not gate.usable:
            look.retake = gate.reason
            look.note += f" It is also unusable as it is: {gate.reason}."
        return look
    if not gate.usable:
        look.inspected_by, look.retake = NOBODY, gate.reason
        look.note = f"Not looked at: {gate.reason}. Take the photo again."
        return look
    zooms = int(getattr(who, "zooms", 0))
    try:
        first = who.look(still, context, reference)
        look.checklist = first
        if first and len(first) == len(ITEMS) and all(f.status == "cannot_see" for f in first):
            look.retake = "the model could not see enough of the machine to answer any item"
            look.note = f"Take the photo again: {look.retake}."
            return look
        present = [f for f in first if f.status == "present"]
        confirm = getattr(who, "confirm", None)
        kept = []
        for f in present:
            if confirm is None or not second_look:
                kept.append(f)
                continue
            ref_crop = _crop(reference, f.box) if reference is not None else None
            answer = confirm(_crop(still, f.box), f, ref_crop)
            if isinstance(answer, bool):
                answer = Second(answer, f.new_since_reference)
            if answer.visible:
                kept.append(replace(f, new_since_reference=answer.new_since_reference))
        look.findings = kept
        look.dropped = len(present) - len(kept)
        look.zooms = int(getattr(who, "zooms", 0)) - zooms
        if look.dropped:
            look.note = (
                f"{look.dropped} first-look finding(s) not confirmed on a second look, left out."
            )
    except Exception as e:  # a failed look must not lose the still
        look.findings = []
        look.note = f"The camera check failed ({type(e).__name__}); look at the still by eye."
    return look
