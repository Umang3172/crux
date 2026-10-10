"""From raw snapshots to a health trend: a few numbers per snapshot.

Everything here is deterministic and needs no bearing geometry, so the same
code runs on any rig whose sampling rate reaches 10 kHz. The forecaster only
ever sees these numbers, never the waveforms or the label.
"""

from __future__ import annotations

import csv
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .runs import Run, read_table

#: Frequency bands whose share of the energy is tracked. Chosen, not physical
#: constants: below 1 kHz holds shaft-order content (1x, 2x, misalignment), and
#: bearing damage first shows as structural resonances excited in the kHz range
#: (docs/DOMAIN.md, envelope analysis). The same edges on every rig keep the
#: features comparable between datasets; 10 kHz is the IMS Nyquist limit.
BANDS_HZ: tuple[tuple[float, float], ...] = (
    (0.0, 1_000.0),
    (1_000.0, 3_000.0),
    (3_000.0, 6_000.0),
    (6_000.0, 10_000.0),
)


@dataclass(frozen=True)
class SnapshotHealth:
    rms: float
    peak: float  # largest absolute acceleration in the snapshot
    kurtosis: float  # 3 for Gaussian noise; impacts push it up
    crest: float  # peak / rms
    band_frac: tuple[float, ...]  # share of the energy in each of BANDS_HZ


def snapshot_health(x: np.ndarray, fs: float) -> SnapshotHealth:
    x = np.asarray(x, dtype=float)
    x = x - float(np.mean(x))
    m2 = float(np.mean(x**2))
    rms = float(np.sqrt(m2))
    peak = float(np.max(np.abs(x))) if len(x) else 0.0
    kurt = float(np.mean(x**4) / m2**2) if m2 > 0 else 0.0
    power = np.abs(np.fft.rfft(x)) ** 2
    freqs = np.fft.rfftfreq(len(x), d=1.0 / fs)
    total = float(power[1:].sum())  # DC already removed; skip its bin
    fracs = tuple(
        float(power[(freqs >= lo) & (freqs < hi)].sum() / total) if total > 0 else 0.0
        for lo, hi in BANDS_HZ
    )
    return SnapshotHealth(rms, peak, kurt, peak / rms if rms > 0 else 0.0, fracs)


@dataclass
class RunHealth:
    """One bearing's health trend. Index i is the i-th snapshot."""

    run_id: str
    source: str
    condition: str
    failed: bool
    t: np.ndarray  # minutes since the first snapshot
    rms: np.ndarray
    peak: np.ndarray
    kurtosis: np.ndarray
    crest: np.ndarray
    bands: np.ndarray  # shape (n, len(BANDS_HZ))
    failure_mode: str = ""
    extra: dict[str, str] = field(default_factory=dict)

    def __len__(self) -> int:
        return len(self.t)

    @property
    def t_end(self) -> float:
        """When the bearing failed: both datasets stopped recording at failure."""
        return float(self.t[-1])

    def remaining(self, i: int) -> float:
        """True minutes left at snapshot i. Only meaningful when `failed`."""
        return self.t_end - float(self.t[i])

    def prefix(self, n: int) -> RunHealth:
        """The first n snapshots, as a live system would have seen them."""
        return RunHealth(
            self.run_id,
            self.source,
            self.condition,
            self.failed,
            self.t[:n],
            self.rms[:n],
            self.peak[:n],
            self.kurtosis[:n],
            self.crest[:n],
            self.bands[:n],
            self.failure_mode,
            dict(self.extra),
        )


#: A snapshot below this share of the healthy RMS means the shaft had stopped.
#: Chosen: IMS tests 2 and 3 end with one or two files at about 1% of the normal
#: level, recorded after the machine was switched off.
STOPPED_FRACTION = 0.1


def trim_stopped(h: RunHealth, n_baseline: int = 10) -> RunHealth:
    """Drop trailing snapshots taken after the machine stopped; failure is the last live one."""
    floor = STOPPED_FRACTION * float(np.mean(h.rms[:n_baseline]))
    n = len(h)
    while n > n_baseline and h.rms[n - 1] < floor:
        n -= 1
    return h if n == len(h) else h.prefix(n)


def from_snapshots(meta: Run, t: Iterable[float], snaps: Iterable[SnapshotHealth]) -> RunHealth:
    snaps = list(snaps)
    return RunHealth(
        run_id=meta.run_id,
        source=meta.source,
        condition=meta.condition,
        failed=meta.failed,
        t=np.asarray(list(t), dtype=float),
        rms=np.array([s.rms for s in snaps]),
        peak=np.array([s.peak for s in snaps]),
        kurtosis=np.array([s.kurtosis for s in snaps]),
        crest=np.array([s.crest for s in snaps]),
        bands=np.array([s.band_frac for s in snaps]).reshape(len(snaps), len(BANDS_HZ)),
        failure_mode=meta.failure_mode,
    )


def build(run: Run, progress: Callable[[int, int], None] | None = None) -> RunHealth:
    """Read every snapshot of a run and summarise it. The slow step: run once, then cache."""
    snaps = []
    for i in range(len(run)):
        snaps.append(snapshot_health(run.load(i), run.fs))
        if progress is not None:
            progress(i + 1, len(run))
    return from_snapshots(run, run.times_min, snaps)


def build_many(
    runs_: Iterable[Run], progress: Callable[[str, int, int], None] | None = None
) -> list[RunHealth]:
    """Like `build`, but runs that share files (IMS bearings on one shaft) read each file once."""
    groups: dict[tuple[Path, ...], list[Run]] = {}
    for r in runs_:
        groups.setdefault(r.files, []).append(r)
    out = []
    for files, members in groups.items():
        snaps: dict[str, list[SnapshotHealth]] = {r.run_id: [] for r in members}
        times: list[float] = []
        damaged: list[str] = []
        for i, f in enumerate(files):
            # A file that cannot be read whole is left out, never patched: the
            # minute is missing from the trend, which the watcher tolerates.
            try:
                table = read_table(f)
            except ValueError:
                damaged.append(f.name)
                continue
            times.append(members[0].times_min[i])
            for r in members:
                snaps[r.run_id].append(snapshot_health(table[:, r.channel], r.fs))
            if progress is not None:
                progress(members[0].run_id, i + 1, len(files))
        for r in members:
            h = from_snapshots(r, times, snaps[r.run_id])
            if damaged:
                h.extra["damaged_files"] = ",".join(damaged)
            out.append(h)
    return out


_COLUMNS = [
    "run_id",
    "source",
    "condition",
    "failed",
    "failure_mode",
    "t_min",
    "rms",
    "peak",
    "kurtosis",
    "crest",
    *(f"band_{int(lo)}_{int(hi)}" for lo, hi in BANDS_HZ),
]


def save(runs: Iterable[RunHealth], path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(_COLUMNS)
        for r in runs:
            for i in range(len(r)):
                w.writerow(
                    [
                        r.run_id,
                        r.source,
                        r.condition,
                        int(r.failed),
                        r.failure_mode,
                        f"{r.t[i]:.4f}",
                        *(f"{v:.6g}" for v in (r.rms[i], r.peak[i], r.kurtosis[i], r.crest[i])),
                        *(f"{v:.6g}" for v in r.bands[i]),
                    ]
                )


def load(path: str | Path) -> list[RunHealth]:
    rows: dict[str, list[dict[str, str]]] = {}
    with Path(path).open(newline="") as fh:
        for row in csv.DictReader(fh):
            rows.setdefault(row["run_id"], []).append(row)
    band_cols = _COLUMNS[10:]
    out = []
    for run_id, rs in rows.items():
        rs.sort(key=lambda r: float(r["t_min"]))
        first = rs[0]

        def col(name: str, rs: list[dict[str, str]] = rs) -> np.ndarray:
            return np.array([float(r[name]) for r in rs])

        out.append(
            RunHealth(
                run_id=run_id,
                source=first["source"],
                condition=first["condition"],
                failed=first["failed"] == "1",
                t=col("t_min"),
                rms=col("rms"),
                peak=col("peak"),
                kurtosis=col("kurtosis"),
                crest=col("crest"),
                bands=np.column_stack([col(c) for c in band_cols]),
                failure_mode=first["failure_mode"],
            )
        )
    return out
