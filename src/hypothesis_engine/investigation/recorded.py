"""Investigate a recorded run: the reading is one snapshot, and any check Crux
asks for is answered from the snapshots that follow it.

This is how a run-to-failure recording stands in for a live machine. The
reading comes from the moment the predictive-maintenance watcher fired; a
requested check is read from the next recording, the way a technician's capture
would be (`measure_from_capture`). The beliefs move only inside the engine, as
always. A check that no recording can answer leaves the case open.
"""

from __future__ import annotations

from collections.abc import Callable

from ..models import InvestigationState, MachineSpec, Observation
from .engine import Investigation


def investigate_recording(
    machine: MachineSpec,
    snapshot: Callable[[int], Observation],
    start: int,
    count: int,
    max_requests: int = 2,
) -> InvestigationState:
    """Run the loop on snapshot `start`; answer checks from `start + 1`, `start + 2`, ..."""
    inv = Investigation(machine, snapshot(start))
    following = iter(range(start + 1, count))

    def answer(test_id: str) -> float | None:
        k = next(following, None)
        if k is None:
            return None
        try:
            return inv.measure_from_capture(test_id, snapshot(k))
        except ValueError:
            return None  # a check no recording can answer, such as a temperature

    return inv.run(max_requests=max_requests, oracle=answer)
