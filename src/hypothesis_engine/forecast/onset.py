"""The watcher: has this bearing left its own healthy level?

It spots change and never diagnoses; what the change *is* stays the
investigation engine's job. It is also the forecaster's starting gun: before
onset there is no trend to extrapolate, and a forecast would only restate the
average life of the training bearings.

Strictly causal: the alarm at snapshot i uses snapshots 0..i only, so a replay
raises it exactly when a live system would have.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

#: Snapshots that define "healthy". Chosen: 10 minutes on XJTU-SY, about 100 on
#: IMS. Short enough to leave most of even a brief run to watch; the evaluation
#: report lists any run too short to have a baseline.
BASELINE_SNAPSHOTS = 10

#: Shewhart's 3-sigma control limit: noise alone crosses it about 0.13% of the
#: time per snapshot (one-sided Gaussian tail).
SIGMA_K = 3.0

#: A run whose baseline is unusually quiet would alarm on a trivial wobble, so
#: the level must also rise by this fraction. Chosen.
MIN_RISE = 0.2

#: Consecutive snapshots above the limit before the alarm fires. Chosen: with
#: three, isolated noise crossings (0.13% each) almost never chain together.
CONSECUTIVE = 3


@dataclass(frozen=True)
class Baseline:
    mean: float
    std: float

    @property
    def limit(self) -> float:
        return max(self.mean + SIGMA_K * self.std, self.mean * (1.0 + MIN_RISE))


def baseline(hi: np.ndarray, n: int = BASELINE_SNAPSHOTS) -> Baseline:
    head = np.asarray(hi[:n], dtype=float)
    return Baseline(float(np.mean(head)), float(np.std(head, ddof=1)) if len(head) > 1 else 0.0)


def detect_onset(
    hi: np.ndarray,
    n_baseline: int = BASELINE_SNAPSHOTS,
    consecutive: int = CONSECUTIVE,
) -> int | None:
    """Index at which the alarm fires, or None if the level never left healthy.

    That is the last of `consecutive` snapshots in a row above the limit, the
    first moment a live watcher could be sure.
    """
    hi = np.asarray(hi, dtype=float)
    if len(hi) < n_baseline + consecutive:
        return None
    limit = baseline(hi, n_baseline).limit
    run = 0
    for i in range(n_baseline, len(hi)):
        run = run + 1 if hi[i] > limit else 0
        if run >= consecutive:
            return i
    return None
