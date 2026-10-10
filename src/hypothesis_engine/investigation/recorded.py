"""Investigate a recorded run: the reading is one snapshot, the machine's own
normal is the start of the same run, and any check Crux asks for is answered
from the snapshots that follow.

This is how a run-to-failure recording stands in for a live machine. The
reading comes from the moment the predictive-maintenance watcher fired. The
run's early snapshots are what a watcher would have on file as the machine
running normally, so the case is scored on the change from them
(`physics.normal`). A requested check is answered by the next recording, handed
over as a capture the way a technician's would be, so it is scored at its own
length and noise. The beliefs move only inside the engine, as always. A check
that no recording can answer is marked as not taken, and the next most useful
one is asked for.

Nothing after the reading is used except to answer a check, and nothing before
it except the early snapshots.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

from ..models import InvestigationState, MachineSpec, Observation
from .catalog import BY_ID
from .engine import Investigation

#: The snapshots taken as a run's own normal: the start of its life, after the
#: first, which on a freshly mounted bearing is still settling.
NORMAL_SNAPSHOTS: tuple[int, ...] = (1, 2, 3, 4, 5)


def open_recording(
    machine: MachineSpec,
    snapshot: Callable[[int], Observation],
    start: int,
    normal: Sequence[int] = NORMAL_SNAPSHOTS,
) -> Investigation:
    """The case on snapshot `start`, compared with the run's own normal: those of
    `normal` that come before it. With none before it the textbook machine stands in."""
    reading = snapshot(start)
    healthy = [snapshot(i) for i in normal if 0 <= i < start]
    return Investigation(machine, reading, normal=healthy)


def investigate_recording(
    machine: MachineSpec,
    snapshot: Callable[[int], Observation],
    start: int,
    count: int,
    max_requests: int = 2,
    normal: Sequence[int] = NORMAL_SNAPSHOTS,
) -> InvestigationState:
    """Run the loop on snapshot `start`; answer checks from `start + 1`, `start + 2`, ..."""
    inv = open_recording(machine, snapshot, start, normal)
    following = iter(range(start + 1, count))

    def answer(test_id: str) -> Observation | None:
        if BY_ID[test_id].capture_s is None:
            return None  # a value a person reads off, such as a temperature
        k = next(following, None)
        return None if k is None else snapshot(k)

    return inv.run(max_requests=max_requests, oracle=answer)
