"""Scoring forecasters on bearings they never saw.

The split is by bearing, never by snapshot. Neighbouring snapshots of one
bearing are near copies, so a random split would let the model memorise the
held-out bearing from its neighbours and report a score that means nothing.

Every bearing counts once: scores are averaged within a bearing first, then
across bearings, so a run with 2,500 snapshots does not drown one with 50.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass

import numpy as np

from .health import RunHealth
from .models import Forecaster, onset_of


@dataclass(frozen=True)
class RunScore:
    run_id: str
    method: str
    onset_min: float | None  # when the watcher fired, minutes from the start
    life_min: float  # when the bearing failed
    lead_min: float | None  # warning the watcher gave: life - onset
    points: int  # forecasts scored, one per snapshot from onset to failure
    norm_error: float | None  # median |p50 - truth| / (life after onset)
    coverage: float | None  # share of truths inside p10..p90 (aim: 0.8)
    late: float | None  # share where even p10 was later than the truth
    note: str = ""


def score_run(model: Forecaster, h: RunHealth) -> RunScore:
    o = onset_of(h)
    life = h.t_end
    if o is None:
        return RunScore(
            h.run_id, model.name, None, life, None, 0, None, None, None, "never left healthy"
        )
    after = life - float(h.t[o])
    idx = list(range(o, len(h)))
    if after <= 0:
        return RunScore(
            h.run_id, model.name, float(h.t[o]), life, 0.0, 0, None, None, None, "alarm at failure"
        )
    fc = model.predict_many(h, idx, o)
    truth = np.array([h.remaining(i) for i in idx])
    p10 = np.array([f.p10 for f in fc])
    p50 = np.array([f.p50 for f in fc])
    p90 = np.array([f.p90 for f in fc])
    return RunScore(
        run_id=h.run_id,
        method=model.name,
        onset_min=float(h.t[o]),
        life_min=life,
        lead_min=after,
        points=len(idx),
        norm_error=float(np.median(np.abs(p50 - truth)) / after),
        coverage=float(np.mean((p10 <= truth) & (truth <= p90))),
        late=float(np.mean(p10 > truth)),
    )


def leave_one_out(runs: Sequence[RunHealth], make: Callable[[], Forecaster]) -> list[RunScore]:
    """Fit on all failed bearings but one, score the one left out, repeat."""
    scored = [h for h in runs if h.failed]
    out = []
    for k, held in enumerate(scored):
        train = [h for j, h in enumerate(scored) if j != k]
        assert all(h.run_id != held.run_id for h in train)
        model = make()
        model.fit(train)
        out.append(score_run(model, held))
    return out


def transfer(
    train: Sequence[RunHealth], test: Sequence[RunHealth], make: Callable[[], Forecaster]
) -> list[RunScore]:
    """Fit once on one rig, score on another with no refitting."""
    model = make()
    model.fit(train)
    return [score_run(model, h) for h in test if h.failed]


@dataclass(frozen=True)
class Summary:
    method: str
    runs_scored: int
    runs_skipped: int
    norm_error: float | None  # mean over bearings of their median normalised error
    coverage: float | None
    late: float | None


def summarise(scores: Sequence[RunScore]) -> Summary:
    ok = [s for s in scores if s.points > 0]

    def mean(name: str) -> float | None:
        vals = [getattr(s, name) for s in ok]
        return float(np.mean(vals)) if vals else None

    return Summary(
        method=scores[0].method if scores else "",
        runs_scored=len(ok),
        runs_skipped=len(scores) - len(ok),
        norm_error=mean("norm_error"),
        coverage=mean("coverage"),
        late=mean("late"),
    )


def as_records(scores: Sequence[RunScore]) -> list[dict]:
    return [asdict(s) for s in scores]
