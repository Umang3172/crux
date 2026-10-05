"""Health percent: one number per machine that anyone on the floor can read.

100% means the part vibrates as it did when new; 0% means it has reached the
danger line. It is *not* life left. A bearing spends most of its life near 100%
and can lose the rest in hours (on IMS, the failing bearings read 90% or more for
54 to 98% of their lives, and test 2 bearing 1 read 78% five hours before it
failed), so the number is never shown alone: a `HealthCard` carries the
watcher's status and, once it has fired, the time-left range.

Like the rest of this package it reads no belief and writes none.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from .health import RunHealth
from .models import DANGER_FACTOR, Forecast, Forecaster, get_forecaster, onset_of
from .onset import BASELINE_SNAPSHOTS

#: Snapshots in the trailing median, so one knock does not move the number.
#: Chosen: an hour on IMS, six minutes on XJTU-SY.
SMOOTH_SNAPSHOTS = 6


def health_percent(h: RunHealth) -> np.ndarray:
    """The percent at every snapshot, using only snapshots up to it.

    Vibration grows by multiplying, so each doubling of the peak above its
    healthy maximum takes the same bite: log10(2), about 30 points, of the way to
    the 10x danger line. Damage does not heal, so the number never rises again,
    even when the level dips: IMS test 1 bearing 4 would otherwise have read 55%
    three days before it failed and 84% one day before.
    """
    peak = np.asarray(h.peak, dtype=float)
    if len(peak) == 0:
        return np.array([], dtype=float)
    healthy = float(np.max(peak[:BASELINE_SNAPSHOTS]))
    level = np.array(
        [np.median(peak[max(0, i - SMOOTH_SNAPSHOTS + 1) : i + 1]) for i in range(len(peak))]
    )
    used = np.log(np.maximum(level, healthy) / healthy) / np.log(DANGER_FACTOR)
    return np.minimum.accumulate(np.clip(100.0 * (1.0 - used), 0.0, 100.0))


@dataclass(frozen=True)
class HealthCard:
    """What a screen shows for one part: the number, and what to do about it."""

    part: str
    percent: float
    status: str  # "normal" or "attention" (the watcher has fired)
    forecast: Forecast | None = None  # minutes to the danger line, once there is one


def health_card(h: RunHealth, forecaster: Forecaster | None = None) -> HealthCard:
    """The card at the latest snapshot."""
    pct = float(health_percent(h)[-1])
    o = onset_of(h)
    if o is None:
        return HealthCard(h.run_id, pct, "normal")
    fc = (forecaster or get_forecaster()).predict_many(h, [len(h) - 1], o)[0]
    return HealthCard(h.run_id, pct, "attention", fc)


def weakest(cards: Sequence[HealthCard]) -> HealthCard:
    """A machine is as healthy as its worst part: a part needing attention first."""
    return min(cards, key=lambda c: (c.status != "attention", c.percent))
