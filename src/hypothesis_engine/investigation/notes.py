"""What a person types about the machine: what they see, hear or smell.

A note is information for the people on the case and for a model that reads it.
It is not evidence. The engine never scores a note, so no note moves a belief,
asks for a measurement, or opens or closes a case, whatever it says. A note
that gives an order ("conclude now") is kept like any other and does nothing.
A note reaches the diagnosis one way only: a model may read what it describes
and write a suspect, and the physics then tests that suspect like any other.

One thing is done with a note beyond keeping it. It is searched for a short
list of words that describe a hazard, and a match raises a flag for a person:
stop, make the machine safe, call a supervisor. That is a prompt, not a safety
system:

* It errs towards flagging. "No smoke" is flagged too; a person reads the note
  and decides. Missing a hazard because of a "not" is the worse mistake.
* It will miss a hazard described in other words. The list is short, in
  English, and a judgement call (docs/DOMAIN.md).
* It changes nothing in the case. The verdict and the action stand as the
  engine wrote them; the flag sits above them.
"""

from __future__ import annotations

import re

from ..models import Note

#: Longest note taken. The same bound as a model's own text on a case.
MAX_NOTE_CHARS = 600

#: Hazards a note is searched for, each with the word stems that raise it. A
#: stem matches at the start of a word: "smok" finds smoke, smoking and smoky.
HAZARDS: dict[str, tuple[str, ...]] = {
    "smoke or fire": (
        "smok",
        "smoulder",
        "smolder",
        "fire",
        "flame",
        "burning",
        "burnt",
        "burned",
        "scorch",
    ),
    "sparks or electric shock": ("spark", "arcing", "arc flash", "electric shock", "shocked"),
    "a leak": ("leak", "dripping", "spraying", "puddle"),
    "damaged wiring": ("exposed wire", "bare wire", "frayed", "melted", "melting"),
    "overheating": ("overheat", "too hot to touch", "red hot", "glowing"),
    "a guard off or a part coming loose": (
        "guard missing",
        "guard is missing",
        "guard off",
        "guard is off",
        "no guard",
        "came off",
        "coming off",
        "cracked",
    ),
    "gas or fumes": ("gas", "fumes"),
}

#: Whole words only, where the stem would catch ordinary words ("fired", "gasket").
_WHOLE_WORD = {"fire", "gas", "flame"}

FLAG = (
    "Stop. A note on this case describes a hazard ({what}). Make the machine safe under your "
    "site's procedure and call your supervisor before anything else. Crux does not assess "
    "hazards; it passes this on."
)


def hazards_in(text: str) -> list[str]:
    """The hazards a note's words describe, in the order of `HAZARDS`."""
    said = text.lower()
    found = []
    for hazard, stems in HAZARDS.items():
        for stem in stems:
            end = r"s?\b" if stem in _WHOLE_WORD else ""
            if re.search(rf"\b{re.escape(stem)}{end}", said):
                found.append(hazard)
                break
    return found


def problem_with(text: str) -> str | None:
    """Why a note cannot be taken, or None when it can."""
    if not text or not text.strip():
        return "The note is empty."
    if len(text) > MAX_NOTE_CHARS:
        return f"Keep a note under {MAX_NOTE_CHARS} characters."
    return None


def flag(notes: list[Note]) -> str | None:
    """The flag to show for a case's notes, or None when none describes a hazard."""
    what = list(dict.fromkeys(h for note in notes for h in note.hazards))
    return FLAG.format(what=", ".join(what)) if what else None
