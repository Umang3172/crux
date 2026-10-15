"""Replay: what the maintenance screen would have shown at each moment of a recorded life.

A run-to-failure recording is replayed as if it were live. Every value at time t
uses snapshots up to t only, so scrubbing the replay shows exactly what a person
watching the machine would have been told, next to what actually happened.

Every forecast in a replay comes from a forecaster that never saw that part:
`machine_replay` asks for one per part, and `held_out` builds it from every
other failed part. Nothing here reads or writes the investigation's beliefs.
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass, replace
from pathlib import Path

import numpy as np

from .health import RunHealth, load, trim_stopped
from .models import Forecaster, TrendExtrapolation, onset_of
from .percent import health_percent
from .runs import DATA_ROOT

FORECAST_DIR = DATA_ROOT / "forecast"
REPLAY_FILE = FORECAST_DIR / "replay.json"

#: Points per chart line. Chosen: finer than a screen-width chart can show.
CHART_POINTS = 400

#: Moments after the alarm at which a time-left range is computed. Chosen: one
#: every few pixels when the alarm-to-failure stretch fills the chart.
FORECAST_POINTS = 80

#: The bearing fitted on each rig, for the ticket's parts line: IMS readme
#: ("Rexnord ZA-2115 double row bearings"), XJTU-SY authors' page (LDK UER204).
_BEARING = {
    "ims": "Rexnord ZA-2115 (double row)",
    "xjtu-sy": "LDK UER204",
    "demo": "SKF 6205-2RS JEM",
}

_SOURCE = {
    "ims": "NASA IMS run-to-failure test (University of Cincinnati)",
    "xjtu-sy": "XJTU-SY accelerated run-to-failure test (Xi'an Jiaotong University)",
    # Shown beside every number that comes from it (`data/demo.py`).
    "demo": "Synthetic pump life (a physics model, not a recording)",
}


@dataclass(frozen=True)
class TimeLeft:
    at_h: float  # running hours when the range was given
    p10_h: float
    p50_h: float
    p90_h: float
    note: str


@dataclass(frozen=True)
class PartReplay:
    part: str
    label: str
    failed: bool
    failure_mode: str
    end_h: float  # running hours recorded; the failure time when `failed`
    alarm_h: float | None  # when the watcher fired, if it did
    t_h: list[float]
    percent: list[float]
    level: list[float]  # RMS as a multiple of its healthy mean
    time_left: list[TimeLeft]
    method: str
    # Share of moments the same method's range held the truth on every other
    # failed part, each forecast by a model that never saw that part. None
    # until `with_record` has scored them. Never this part's own score: that
    # would give away how its life ended.
    held_elsewhere: float | None = None
    held_parts: int = 0


@dataclass(frozen=True)
class MachineReplay:
    machine: str
    name: str
    source: str
    end_h: float
    parts: list[PartReplay]
    bearing: str = "TBD"


def _label(h: RunHealth) -> str:
    """`ims/test1/bearing3` -> "Bearing 3". An XJTU-SY run tests one bearing: "Test bearing"."""
    if h.source == "xjtu-sy":
        return "Test bearing"
    if h.source == "demo":
        return "Drive-end bearing"
    last = h.run_id.rsplit("/", 1)[-1]
    if last.lower().startswith("bearing"):
        return "Bearing " + last[len("bearing") :].replace("_", "-")
    return last


def _hours(minutes: float) -> float:
    return round(float(minutes) / 60.0, 4)


def replay_part(
    h: RunHealth,
    forecaster: Forecaster,
    chart_points: int = CHART_POINTS,
    forecast_points: int = FORECAST_POINTS,
) -> PartReplay:
    n = len(h)
    pct = health_percent(h)
    healthy_rms = float(np.mean(h.rms[: min(n, 10)]))
    o = onset_of(h)
    idx = np.unique(np.linspace(0, n - 1, min(n, chart_points)).round().astype(int))
    if o is not None:
        idx = np.unique(np.append(idx, o))
    ranges: list[TimeLeft] = []
    if o is not None:
        at = np.unique(np.linspace(o, n - 1, min(n - o, forecast_points)).round().astype(int))
        for i, f in zip(at, forecaster.predict_many(h, list(at), o), strict=True):
            ranges.append(
                TimeLeft(_hours(h.t[i]), _hours(f.p10), _hours(f.p50), _hours(f.p90), f.note)
            )
    return PartReplay(
        part=h.run_id,
        label=_label(h),
        failed=h.failed,
        failure_mode=h.failure_mode,
        end_h=_hours(h.t_end),
        alarm_h=_hours(h.t[o]) if o is not None else None,
        t_h=[_hours(h.t[i]) for i in idx],
        percent=[round(float(pct[i]), 2) for i in idx],
        level=[round(float(h.rms[i]) / healthy_rms, 4) for i in idx],
        time_left=ranges,
        method=getattr(forecaster, "name", type(forecaster).__name__),
    )


def machine_key(h: RunHealth) -> str:
    """Parts that share a shaft and a clock form one machine: an IMS test, or one XJTU-SY run."""
    return f"ims/{h.condition}" if h.source == "ims" else h.run_id


def _machine_name(key: str, parts: Sequence[RunHealth]) -> str:
    if key.startswith("ims/"):
        return f"NASA test rig, {key.split('/', 1)[1].replace('test', 'test ')}"
    h = parts[0]
    if h.source == "demo":
        return "Chilled-water pump 2 (synthetic)"
    run = h.run_id.rsplit("/", 1)[-1].replace("Bearing", "").replace("_", "-")
    return f"XJTU-SY run {run} ({h.condition})" if h.source == "xjtu-sy" else h.run_id


def machine_replay(
    key: str, parts: Sequence[RunHealth], forecaster_for: Callable[[RunHealth], Forecaster]
) -> MachineReplay:
    ordered = sorted(parts, key=lambda h: h.run_id)
    return MachineReplay(
        machine=key,
        name=_machine_name(key, ordered),
        source=_SOURCE.get(ordered[0].source, ordered[0].source),
        end_h=_hours(max(h.t_end for h in ordered)),
        parts=[replay_part(h, forecaster_for(h)) for h in ordered],
        bearing=_BEARING.get(ordered[0].source, "TBD"),
    )


def held_out(
    make: Callable[[], Forecaster], runs: Sequence[RunHealth]
) -> Callable[[RunHealth], Forecaster]:
    """A forecaster per part, fitted on every failed part except that one."""
    cache: dict[frozenset[str], Forecaster] = {}

    def for_part(h: RunHealth) -> Forecaster:
        train = [r for r in runs if r.failed and r.run_id != h.run_id]
        key = frozenset(r.run_id for r in train)
        if key not in cache:
            f = make()
            f.fit(train)
            cache[key] = f
        return cache[key]

    return for_part


def held_share(p: PartReplay) -> float | None:
    """Share of this part's ranges that held the truth, if it failed and was forecast."""
    if not p.failed or not p.time_left:
        return None
    return float(np.mean([t.p10_h <= p.end_h - t.at_h <= t.p90_h for t in p.time_left]))


def with_record(machines: Sequence[MachineReplay]) -> list[MachineReplay]:
    """Each part told how its method's ranges did on the other failed parts.

    Each other part counts once, however many ranges it has, as in
    `evaluate.py`. Parts on a different method are not counted.
    """
    parts = [p for m in machines for p in m.parts]
    scores = {(p.part, p.method): s for p in parts if (s := held_share(p)) is not None}

    def record(p: PartReplay) -> PartReplay:
        other = [s for (part, method), s in scores.items() if method == p.method and part != p.part]
        if not other:
            return p
        return replace(p, held_elsewhere=round(float(np.mean(other)), 4), held_parts=len(other))

    return [replace(m, parts=[record(p) for p in m.parts]) for m in machines]


def available_runs(directory: Path = FORECAST_DIR) -> list[RunHealth]:
    """Every health table built so far, with snapshots after the machine stopped removed."""
    found = []
    for table in sorted(directory.glob("health_*.csv")):
        found.extend(trim_stopped(h) for h in load(table))
    return found


def build_all(
    runs: Sequence[RunHealth], forecaster_for: Callable[[RunHealth], Forecaster]
) -> list[MachineReplay]:
    groups: dict[str, list[RunHealth]] = {}
    for h in runs:
        groups.setdefault(machine_key(h), []).append(h)
    return [machine_replay(k, v, forecaster_for) for k, v in sorted(groups.items())]


def _finite(x: object) -> object:
    if isinstance(x, float) and not math.isfinite(x):
        return None
    if isinstance(x, dict):
        return {k: _finite(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_finite(v) for v in x]
    return x


def to_json(machines: Sequence[MachineReplay]) -> list[dict]:
    return [_finite(asdict(m)) for m in machines]  # type: ignore[misc]


def save(machines: Sequence[MachineReplay], path: Path = REPLAY_FILE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(to_json(machines)))


def load_or_build(path: Path | None = None) -> list[dict]:
    """The saved replay if `scripts/forecast.py replay` wrote one, else the trend on the fly."""
    path = path if path is not None else REPLAY_FILE
    if path.exists():
        return json.loads(path.read_text())
    runs = available_runs(path.parent)
    return to_json(with_record(build_all(runs, lambda _h: TrendExtrapolation())))
