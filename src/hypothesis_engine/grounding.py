"""The rule everything a model writes is held to.

A sentence must cite the evidence it rests on, and every number in it must be
in what it cites. It is the one check, used wherever a model's words reach a
person: the repair ticket, the explanation beside a verdict, and the
description of a suspect written from a document. A sentence that fails is
removed, with the reason.

It is a check on numbers and on citations. It cannot tell whether a sentence
that passes is a fair reading of its evidence; callers that need more add their
own rules on top (`agents.report`).

This module depends on nothing else in the project, so the tool layer can use it
without pulling in a model adapter or an image library.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Evidence:
    id: str
    kind: str  # sensor | forecast | camera | record | status | engine | document
    statement: str
    numbers: tuple[float, ...] = ()
    key: tuple[float, ...] = ()  # numbers a sentence citing this must state, e.g. a range's ends


@dataclass(frozen=True)
class Sentence:
    text: str
    cites: tuple[str, ...]


_NUMBER = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?")


def written_numbers(text: str) -> list[str]:
    """The numbers a sentence states, as written. A digit inside a word or an id
    ("E12", "2x") is not one."""
    return _NUMBER.findall(text)


_ANY_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def numbers_in(text: str) -> tuple[float, ...]:
    """Every number a piece of evidence holds. On this side every digit run
    counts, so "40Hz10kN" offers both 40 and 10."""
    return tuple(float(n) for n in _ANY_NUMBER.findall(text))


def matches(written: str, values: tuple[float, ...]) -> bool:
    """A written number matches a value if it is that value rounded as written."""
    x = float(written)
    places = len(written.split(".")[1]) if "." in written else 0
    tol = 0.5 * 10**-places + 1e-9
    return any(abs(v - x) <= tol for v in values)


def unbacked(sentence: Sentence, by_id: dict[str, Evidence]) -> str | None:
    """Why the evidence does not back a sentence, or None when it does: it must
    cite evidence that exists, and every number in it must be in what it cites."""
    if not sentence.cites:
        return "it cites no evidence"
    unknown = [c for c in sentence.cites if c not in by_id]
    if unknown:
        return f"it cites {', '.join(unknown)}, which is not in the evidence"
    values = tuple(v for c in sentence.cites for v in by_id[c].numbers)
    stray = [n for n in written_numbers(sentence.text) if not matches(n, values)]
    if stray:
        return f"{', '.join(stray)} is not in the evidence it cites"
    return None


def check(
    sentences: list[Sentence], evidence: list[Evidence]
) -> tuple[list[Sentence], list[Sentence]]:
    """(kept, removed): kept sentences cite real evidence and every number in them is in it."""
    by_id = {e.id: e for e in evidence}
    kept, removed = [], []
    for s in sentences:
        (kept if unbacked(s, by_id) is None else removed).append(s)
    return kept, removed
