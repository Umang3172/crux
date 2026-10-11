"""The repair ticket: what to fix, by when, and every sentence tied to evidence.

A ticket is drafted the moment a part needs attention. It is built from
evidence items (the health reading, the alarm, the time-left range, the
planned-stop risk, the camera look, the machine record), each with an id and
the numbers it holds. A writer turns them into sentences, each citing the ids
it rests on. Then `check` (`grounding.py`) keeps only the sentences whose every
number appears in the evidence they cite; anything else is removed and listed,
so a model cannot slip in a figure nobody measured.

It never reads the dataset's answer key: what is wrong comes from the
investigation or is stated as not yet known. It only ever recommends: a person
approves the ticket, and nothing here touches a machine.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import asdict, dataclass, field
from typing import Protocol

from ..agents.factory import gemini_model_id, gemini_route, not_live
from ..grounding import Evidence, Sentence, check, matches, unbacked, written_numbers
from .camera import CameraLook

# The check lives in `grounding`, shared with the verdict's explanation and with
# suspects written from a document. Its names stay importable from here.
__all__ = ["Evidence", "Sentence", "Ticket", "check", "draft", "unbacked"]

SAFETY = (
    "Crux only recommends. A person approves this ticket, and the machine is isolated and "
    "locked out under the site's own procedure before anyone works on it."
)


@dataclass
class Ticket:
    id: str
    machine: str
    machine_name: str
    part: str
    part_label: str
    at_h: float
    status: str  # draft | approved
    fix_within_h: tuple[float, float] | None
    likely_h: float | None
    stop_in_h: float | None
    risk_before_stop: float | None
    sentences: list[Sentence]
    removed: list[Sentence]
    evidence: list[Evidence]
    camera: CameraLook | None
    has_still: bool
    written_by: str
    safety: str = SAFETY
    approved_by: str = ""
    hazard: bool = False
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


# ------------------------------------------------------------------ the check

# "(E1)", "[E1, E2]" or stray JSON braces a model leaves in its text; the screen
# shows citations itself.
_INLINE_CITE = re.compile(r"\s*[(\[](?:E\d+(?:,\s*)?)+[)\]]|[{}]")
# Evidence side: every digit run counts, so "40Hz10kN" offers both 40 and 10.
_ANY_NUMBER = re.compile(r"\d+(?:\.\d+)?")

#: Evidence every ticket must state, when it exists: the reading, the alarm, the
#: time-left range, the planned-stop risk, the camera, what is known of the
#: cause, the part to have ready, and lessons from past cases.
_MUST_CARRY = ("E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8")


# ------------------------------------------------------------------ writers


def _h(x: float) -> str:
    return f"{x:.1f}" if x < 10 else f"{x:.0f}"


def chance(p: float) -> tuple[str, float]:
    """A probability in words, never "0%" or "100%": the model is not that sure."""
    if p > 0.99:
        return "more than 99%", 99.0
    if p < 0.01:
        return "less than 1%", 1.0
    return f"{p * 100:.0f}%", p * 100


class Writer(Protocol):
    name: str

    def write(self, evidence: list[Evidence], facts: dict) -> list[Sentence]: ...


class TemplateWriter:
    """The offline writer: one plain sentence per piece of evidence."""

    name = "template"

    def write(self, evidence: list[Evidence], facts: dict) -> list[Sentence]:
        ids = {e.id for e in evidence}
        out = [
            Sentence(
                f"{facts['part_label']} on {facts['machine_name']} needs attention: its vibration "
                f"is {facts['level']:.1f} times its normal level and its health reads "
                f"{facts['percent']:.0f}%.",
                ("E0", "E1", "E2"),
            )
        ]
        if "E3" in ids:
            lo, hi = facts["fix_within_h"]
            out.append(
                Sentence(
                    f"Plan the repair within {_h(lo)} to {_h(hi)} hours; most likely in about "
                    f"{_h(facts['likely_h'])} hours.",
                    ("E3",),
                )
            )
        if "E4" in ids:
            out.append(
                Sentence(
                    f"If it waits for the planned stop in {_h(facts['stop_in_h'])} hours, the chance "
                    f"it reaches the danger line first is {chance(facts['risk'])[0]}.",
                    ("E4",),
                )
            )
        if "E5" in ids:
            out.append(Sentence(facts["camera_sentence"], ("E5",)))
        out.append(Sentence(facts["diagnosis_sentence"], ("E6",)))
        out.append(Sentence(f"Bearing to have ready: {facts['bearing']}.", ("E7",)))
        if "E8" in ids:
            out.append(Sentence(facts["lessons_sentence"], ("E8",)))
        return out


WRITER_PROMPT = """Write a short repair ticket for a maintenance technician from
the evidence below. Plain words, no jargon, at most 7 sentences. Every sentence
must cite the evidence ids it rests on, and may only use numbers that appear in
those evidence items (rounding is fine). Do not say what is wrong unless the
evidence says it. Return JSON: [{"text": "...", "cites": ["E1", ...]}].
Evidence:
"""


class GeminiWriter:
    def __init__(self) -> None:
        from google import genai  # type: ignore

        self.model = gemini_model_id("ticket_writer")
        self.name = f"gemini:{self.model}"
        self._client = genai.Client()

    def write(self, evidence: list[Evidence], facts: dict) -> list[Sentence]:
        from google.genai import types  # type: ignore

        listing = "\n".join(f"{e.id} ({e.kind}): {e.statement}" for e in evidence)
        response = self._client.models.generate_content(
            model=self.model,
            contents=[WRITER_PROMPT + listing],
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        items = json.loads(response.text or "[]")
        return [Sentence(str(i["text"]), tuple(str(c) for c in i.get("cites", []))) for i in items]


_SENTENCES = {
    "type": "object",
    "properties": {
        "sentences": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "cites": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["text", "cites"],
            },
        }
    },
    "required": ["sentences"],
}


class LocalWriter:
    """The same job on a local model through Ollama (Gemma 4 until Gemini is set up)."""

    def __init__(self) -> None:
        from ..agents import ollama

        if not ollama.available():
            raise RuntimeError("no local model")
        self._ollama = ollama
        self.name = f"ollama:{ollama.model()}"

    def write(self, evidence: list[Evidence], facts: dict) -> list[Sentence]:
        listing = "\n".join(f"{e.id} ({e.kind}): {e.statement}" for e in evidence)
        prompt = WRITER_PROMPT.replace("Return JSON: [", 'Return JSON: {"sentences": [').replace(
            "...]}].", "...]}]}."
        )
        items = json.loads(self._ollama.chat(prompt + listing, schema=_SENTENCES))["sentences"]
        return [Sentence(str(i["text"]), tuple(str(c) for c in i.get("cites", []))) for i in items]


def get_writer() -> Writer:
    """Gemini, else a local model if OLLAMA_MODEL is set and answering, else templates."""
    if gemini_route() is not None:
        try:
            return GeminiWriter()
        except Exception as exc:  # the adapter is optional; say why it is not live
            not_live("ticket_writer", exc)
    if os.getenv("OLLAMA_MODEL"):
        try:
            return LocalWriter()
        except Exception as exc:  # server down or model missing
            not_live("ticket_writer_local", exc)
    return TemplateWriter()


# ------------------------------------------------------------------ drafting


def camera_sentence(look: CameraLook) -> str:
    if not look.findings:
        if look.inspected_by == "offline":
            return f"A still from {look.camera} is attached; nobody has looked at it yet."
        return f"The still from {look.camera} shows nothing visibly wrong."
    seen = "; ".join(f"{f.what} ({f.where})" for f in look.findings)
    return f"The still from {look.camera} may show: {seen}. Not confirmed: check it on site."


def draft(
    *,
    ticket_id: str,
    machine: str,
    machine_name: str,
    part: str,
    part_label: str,
    bearing: str,
    at_h: float,
    percent: float,
    level: float,
    alarm_h: float,
    time_left: tuple[float, float, float] | None,
    stop_in_h: float | None,
    risk: float | None,
    look: CameraLook | None,
    has_still: bool,
    diagnosis: str | None = None,
    lessons: list[str] | None = None,
    writer: Writer | None = None,
) -> Ticket:
    """Collect the evidence, have it written up, and keep only what the evidence backs."""
    where = f"{part_label} on {machine_name}"
    ev = [
        Evidence("E0", "record", where, _numbers_in(where)),
        Evidence("E1", "sensor", f"health reads {percent:.0f}%", (percent,)),
        Evidence(
            "E2",
            "sensor",
            f"vibration {level:.2f} times its normal level; alarm raised at running hour {alarm_h:.1f}",
            (level, alarm_h),
        ),
    ]
    facts: dict = {
        "machine_name": machine_name,
        "part_label": part_label,
        "percent": percent,
        "level": level,
        "bearing": bearing,
    }
    if time_left is not None:
        lo, mid, hi = time_left
        ev.append(
            Evidence(
                "E3",
                "forecast",
                f"time left to the danger line: {lo:.1f} to {hi:.1f} hours, most likely {mid:.1f}",
                (lo, mid, hi),
                key=(lo, hi),
            )
        )
        facts.update(fix_within_h=(lo, hi), likely_h=mid)
    if stop_in_h is not None and risk is not None:
        said, shown = chance(risk)
        ev.append(
            Evidence(
                "E4",
                "forecast",
                f"planned stop in {stop_in_h:.1f} hours; chance of reaching the line first {said}",
                (stop_in_h, risk * 100, shown),
                key=(shown,),
            )
        )
        facts.update(stop_in_h=stop_in_h, risk=risk)
    if look is not None:
        said = camera_sentence(look)
        nums = tuple(f.confidence * 100 for f in look.findings) + _numbers_in(said)
        ev.append(Evidence("E5", "camera", said, nums))
        facts["camera_sentence"] = camera_sentence(look)
    diag = (
        diagnosis
        or "Not investigated yet: Crux will ask for the one check that settles what is wrong."
    )
    ev.append(Evidence("E6", "status", diag, _numbers_in(diag)))
    facts["diagnosis_sentence"] = diag
    ev.append(Evidence("E7", "record", f"fitted bearing: {bearing}", _numbers_in(bearing)))
    if lessons:
        said = "Past cases say: " + " ".join(lessons)
        ev.append(Evidence("E8", "lesson", said, _numbers_in(said)))
        facts["lessons_sentence"] = said

    who = writer or get_writer()
    notes: list[str] = []
    try:
        sentences = who.write(ev, facts)
    except Exception as e:  # the ticket must still be written
        notes.append(f"{who.name} failed ({type(e).__name__}); written from templates instead")
        who = TemplateWriter()
        sentences = who.write(ev, facts)
    sentences = [Sentence(_INLINE_CITE.sub("", x.text).strip(), x.cites) for x in sentences]
    kept, removed = check(sentences, ev)
    # A model may leave out what matters most. Every piece of evidence a ticket
    # must carry gets its plain template sentence back if no kept sentence cites it.
    by_id = {e.id: e for e in ev}

    def states(x: Sentence, e: Evidence) -> bool:
        written = written_numbers(x.text)
        return all(any(matches(w, (k,)) for w in written) for k in e.key)

    # A sentence that cites a range or a chance but leaves its numbers out does not carry it.
    vague = {
        i
        for i in _MUST_CARRY
        if i in by_id
        and by_id[i].key
        and not any(i in x.cites and states(x, by_id[i]) for x in kept)
    }
    kept = [x for x in kept if not (set(x.cites) & vague and len(x.cites) == 1)]
    cited = {c for x in kept for c in x.cites} - vague
    missing = [i for i in _MUST_CARRY if i in by_id and i not in cited]
    if missing:
        fallback = {c: x for x in TemplateWriter().write(ev, facts) for c in x.cites}
        for i in missing:
            if fallback.get(i) is not None and fallback[i] not in kept:
                kept.append(fallback[i])
        notes.append(f"{who.name} left out {', '.join(missing)}; added from templates")
    return Ticket(
        id=ticket_id,
        machine=machine,
        machine_name=machine_name,
        part=part,
        part_label=part_label,
        at_h=at_h,
        status="draft",
        fix_within_h=(time_left[0], time_left[2]) if time_left else None,
        likely_h=time_left[1] if time_left else None,
        stop_in_h=stop_in_h,
        risk_before_stop=risk,
        sentences=kept,
        removed=removed,
        evidence=ev,
        camera=look,
        has_still=has_still,
        written_by=who.name,
        hazard=bool(look and any(f.hazard for f in look.findings)),
        notes=notes,
    )


def _numbers_in(text: str) -> tuple[float, ...]:
    return tuple(float(n) for n in _ANY_NUMBER.findall(text))
