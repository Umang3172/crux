"""What is written down about a machine, cut into passages that can be looked up.

A machine's manual and maintenance file hold things no sensor reports and no
bearing table lists: what else turns with the shaft, how it is driven, what was
fitted. When the capture holds something no suspect explains, that is where the
missing cause may be named.

A passage is knowledge, never evidence. Nothing here is read when a belief is
computed. What a passage can do is give a model something to write a suspect
from; the physics then simulates that suspect and tests it like any other, and
the passage it came from is kept with it (`tools.investigator.propose_suspect`).

Looking up is by the words a passage shares with the question (tf-idf): enough
for the few documents on file, and it runs with no model and no network. An
embedding index would go behind `KnowledgeBase.search`.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

from .documents import DOCUMENTS, Document

__all__ = ["Document", "KnowledgeBase", "Passage", "for_machine"]

#: Most passages one question brings back. A model's context and a screen both
#: stay short, and a question that needs more is too broad.
TOP = 3

_WORD = re.compile(r"[a-z]+|\d+(?:\.\d+)?")


@dataclass(frozen=True)
class Passage:
    id: str  # K1, K2, ... in the order the documents are on file
    document: str  # the document's title
    section: str
    text: str
    note: str = ""  # what kind of document it is, when that needs saying


def _words(text: str) -> list[str]:
    return _WORD.findall(text.lower())


class KnowledgeBase:
    """The documents on file for one machine, as passages."""

    def __init__(self, documents: Sequence[Document] = ()) -> None:
        passages: list[Passage] = []
        for doc in documents:
            for section, text in doc.sections():
                passages.append(
                    Passage(f"K{len(passages) + 1}", doc.title, section, text, doc.note)
                )
        self.documents = tuple(documents)
        self.passages = tuple(passages)
        self._counts = [Counter(_words(f"{p.section} {p.text}")) for p in self.passages]
        self._df = Counter(w for c in self._counts for w in c)

    def get(self, passage_id: str) -> Passage | None:
        return next((p for p in self.passages if p.id == passage_id), None)

    def _vector(self, counts: Counter) -> dict[str, float]:
        n = len(self.passages)
        return {w: tf * math.log(1.0 + n / self._df.get(w, 1)) for w, tf in counts.items()}

    def search(self, question: str, k: int = TOP) -> list[Passage]:
        """The passages whose words best match the question, best first. A
        passage that shares no word with it is never returned."""
        q = self._vector(Counter(_words(question)))
        qn = math.sqrt(sum(v * v for v in q.values())) or 1.0
        scored = []
        for passage, counts in zip(self.passages, self._counts, strict=True):
            v = self._vector(counts)
            dot = sum(q[w] * v[w] for w in q if w in v)
            if dot > 0:
                vn = math.sqrt(sum(x * x for x in v.values())) or 1.0
                scored.append((dot / (qn * vn), passage))
        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [passage for _, passage in scored[:k]]


def for_machine(machine_id: str) -> KnowledgeBase:
    """What is on file for a machine. Empty when nothing is."""
    return KnowledgeBase(DOCUMENTS.get(machine_id, ()))
