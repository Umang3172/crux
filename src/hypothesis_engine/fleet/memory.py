"""The lesson memory: how a site gets better from its own cases and other sites'.

Modelled on ReasoningBank (Ouyang et al., arXiv 2509.25140, Google, 2025): after
each finished case a short lesson is written, from a success (a strategy that
worked) or a failure (a pitfall to avoid), and the most relevant lessons are
recalled into the next case. No model weights change; the memory grows. A lesson
from a failure is worth as much as one from a success, which is why a wrong
prediction confirmed by a technician is written down, not hidden.

Lessons are knowledge, never evidence: they can point a technician at a check
or remind the ticket writer of a pitfall, but they do not move a belief.
"""

from __future__ import annotations

import json
import math
import re
import uuid
from collections import Counter
from collections.abc import Iterable
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from ..forecast.runs import DATA_ROOT

SITE_DIR = DATA_ROOT / "site"
MEMORY_FILE = SITE_DIR / "memory.jsonl"


@dataclass(frozen=True)
class Lesson:
    machine_type: str  # which specialist pack it belongs to, e.g. "rolling bearing"
    title: str  # one line
    when: str  # the situation it applies to, in the words a technician would use
    do: str  # what to do or check
    avoid: str = ""  # the pitfall, when the lesson comes from a failure
    outcome: str = "success"  # success | failure
    source: str = "this site"  # a site id, or "hub"
    cases: tuple[str, ...] = ()  # tickets or cases it was learned from
    confirmed_by: str = ""  # the person who confirmed what happened
    created: str = field(default_factory=lambda: datetime.now(UTC).isoformat(timespec="seconds"))
    id: str = field(default_factory=lambda: f"L-{uuid.uuid4().hex[:8]}")

    def text(self) -> str:
        return " ".join((self.title, self.when, self.do, self.avoid))


_WORD = re.compile(r"[a-z0-9]+")
_STOP = frozenset(
    "a an and are as at be by for from has have in is it its of on or that the this to was "
    "were with when what which who will not no".split()
)


def _words(text: str) -> list[str]:
    return [w for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 1]


class Memory:
    """An append-only file of lessons, recalled by word overlap (offline, explainable)."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path if path is not None else MEMORY_FILE

    def all(self) -> list[Lesson]:
        if not self.path.exists():
            return []
        out = []
        for line in self.path.read_text().splitlines():
            if line.strip():
                d = json.loads(line)
                d["cases"] = tuple(d.get("cases", ()))
                out.append(Lesson(**d))
        return out

    def add(self, lessons: Iterable[Lesson]) -> list[Lesson]:
        """Append lessons not already held (same id). Returns those added."""
        have = {x.id for x in self.all()}
        new = [x for x in lessons if x.id not in have]
        if new:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a") as fh:
                for x in new:
                    fh.write(json.dumps(asdict(x)) + "\n")
        return new

    def recall(self, machine_type: str, situation: str, k: int = 3) -> list[Lesson]:
        """The k lessons for this machine type whose words best match the situation.

        Scored by tf-idf cosine over the lessons of that type; a lesson sharing
        no word with the situation is never returned.
        """
        pool = [x for x in self.all() if x.machine_type == machine_type]
        if not pool:
            return []
        docs = [Counter(_words(x.text())) for x in pool]
        df = Counter(w for d in docs for w in d)
        n = len(docs)

        def vec(c: Counter) -> dict[str, float]:
            return {w: tf * math.log(1.0 + n / df.get(w, 1)) for w, tf in c.items()}

        q = vec(Counter(_words(situation)))
        qn = math.sqrt(sum(v * v for v in q.values())) or 1.0
        scored = []
        for lesson, d in zip(pool, docs, strict=True):
            v = vec(d)
            dot = sum(q[w] * v[w] for w in q if w in v)
            if dot > 0:
                vn = math.sqrt(sum(x * x for x in v.values())) or 1.0
                scored.append((dot / (qn * vn), lesson))
        scored.sort(key=lambda s: -s[0])
        return [lesson for _, lesson in scored[:k]]
