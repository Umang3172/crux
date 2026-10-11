"""What earlier cases on a machine came to.

When a case closes, the engine's own account of it is kept: the machine, how it
ended, what settled it and, later, what the check after the repair found. The
next case on that machine is shown those records, and so is a model working it.

A record is knowledge, never evidence. Nothing here is read when a belief is
computed, and an earlier verdict is not a prior for the next case: every case
starts from even odds, because how often a fault recurs on this machine is not
something anyone has measured. What a record can do is tell a person, or a
model, where to look.

Records are written from the closed case by code. A model has no tool that
writes one, so the memory holds what the engine concluded, not what anything
said about it.
"""

from __future__ import annotations

import json
import threading
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .catalog import BY_ID
from .engine import Investigation, _pct

#: Most earlier cases shown for one machine, newest first. A screen and a model's
#: context both stay short; older ones are still in the store.
SHOWN = 5

_REPAIR = {
    "verified": "the repair was verified",
    "still_there": "the check after the repair found the fault still there",
    "something_else": "the check after the repair found a different fault",
    "cause_gone": "after the repair that fault was gone and nothing else was settled",
    "cannot_tell": "the check after the repair could not tell",
}


@dataclass(frozen=True)
class CaseRecord:
    """One closed case, in the engine's own terms."""

    case_id: str
    machine: str  # whose machine and which one: "<plant>/<machine id>"
    closed_at: str  # ISO time, UTC
    outcome: str  # concluded | unresolved
    cause: str | None = None  # the hypothesis named, by name
    cause_label: str | None = None
    belief: float | None = None
    reason: str = ""  # why there was no verdict, in the engine's words
    settled_by: tuple[str, ...] = ()  # the readings taken, by name; none means the first capture
    written: tuple[str, ...] = ()  # suspects written during the case that the physics took on
    repair: str = ""  # what the check after the repair found; "" when there was none

    def sentence(self) -> str:
        """The record as one plain sentence."""
        if self.outcome == "concluded":
            how = (
                f"after {len(self.settled_by)} more reading"
                f"{'s' if len(self.settled_by) > 1 else ''} ({', '.join(self.settled_by)})"
                if self.settled_by
                else "from the first capture alone"
            )
            said = f"{(self.cause_label or '').capitalize()} at {_pct(self.belief or 0.0)} belief, {how}"
            if self.cause in self.written:
                said += "; a cause written during the case, not one from the list"
        else:
            said = f"No cause was named. {self.reason}".strip().rstrip(".")
        if self.repair:
            said += f"; {_REPAIR.get(self.repair, self.repair)}"
        return said + "."

    def to_dict(self) -> dict[str, Any]:
        return {**asdict(self), "sentence": self.sentence()}


def machine_key(plant: str, machine_id: str) -> str:
    return f"{plant}/{machine_id}"


def record_of(investigation: Investigation, machine: str) -> CaseRecord:
    """A closed case as a record. Raises for a case that is still open."""
    state = investigation.state
    if state.outcome == "open":
        raise ValueError("the case is still open: there is nothing to remember yet")
    verdict = state.conclusion
    named = investigation.hypothesis(verdict.cause) if verdict is not None else None
    return CaseRecord(
        case_id=state.id,
        machine=machine,
        closed_at=datetime.now(UTC).isoformat(),
        outcome=state.outcome,
        cause=None if verdict is None else verdict.cause,
        cause_label=None if named is None else named.label,
        belief=None if verdict is None else round(verdict.confidence, 4),
        reason=state.unresolved_reason or "",
        settled_by=tuple(BY_ID[o.test_id].name for o in state.outcomes),
        written=tuple(s.name for s in investigation.written_suspects),
    )


class History:
    """Closed cases, by machine. In memory, and in a file as well when given one.

    The file is JSON lines, rewritten whole on each change: a site closes a few
    cases a day. A database goes behind the same four methods.
    """

    def __init__(self, path: Path | None = None) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._records: dict[str, CaseRecord] = {}
        if path is not None and path.exists():
            for line in path.read_text().splitlines():
                if line.strip():
                    raw = json.loads(line)
                    raw["settled_by"] = tuple(raw.get("settled_by", ()))
                    raw["written"] = tuple(raw.get("written", ()))
                    self._records[raw["case_id"]] = CaseRecord(**raw)

    def add(self, record: CaseRecord) -> None:
        """Keep a record. A case already on file keeps its closing time."""
        with self._lock:
            kept = self._records.get(record.case_id)
            if kept is not None:
                record = replace(record, closed_at=kept.closed_at, repair=kept.repair)
            self._records[record.case_id] = record
            self._save()

    def note_repair(self, case_id: str, found: str) -> CaseRecord | None:
        """Add what the check after the repair found to a case on file."""
        with self._lock:
            kept = self._records.get(case_id)
            if kept is None:
                return None
            self._records[case_id] = replace(kept, repair=found)
            self._save()
            return self._records[case_id]

    def get(self, case_id: str) -> CaseRecord | None:
        return self._records.get(case_id)

    def earlier(self, machine: str) -> list[CaseRecord]:
        """The latest closed cases on a machine, newest first. Asked for when a
        case opens, it is what was known about the machine at that moment."""
        found = [r for r in self._records.values() if r.machine == machine]
        return sorted(found, key=lambda r: r.closed_at, reverse=True)[:SHOWN]

    def _save(self) -> None:
        if self._path is None:
            return
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text("".join(json.dumps(asdict(r)) + "\n" for r in self._records.values()))
