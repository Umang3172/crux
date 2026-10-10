#!/usr/bin/env python3
"""Score the Lens sound check on real microphone recordings.

    uv run python scripts/lens_sound_eval.py                      # every dataset found under data/
    uv run python scripts/lens_sound_eval.py --dataset jung2023   # one dataset
    uv run python scripts/lens_sound_eval.py --snr 20             # phone emulation plus noise at 20 dB
    uv run python scripts/lens_sound_eval.py --label-check        # MaFaulDa: the bearing line each folder carries

Every recording is checked twice: as the dataset's microphone heard it ("raw"),
and as a phone might have ("phone": resampled to 48 kHz, cut below 200 Hz;
lens/phone.py). Each check is `experiments.sound_experiments`, the call a Lens
scan makes, given the dataset's shaft speed (MaFaulDa: read from the file's own
tachometer; Jung et al.: the stated 3,010 rpm) and the dataset's bearing.

Reported per condition: true cause against leading cause; how often the top two
are within TIE ("can't tell"); for bearing faults, the rank of the right one;
shaft faults on their own rows, since sound speaks mainly to bearings. Ball and
cage faults are causes Crux does not hold: for them the table shows whether a
bearing fault at least leads. Labels are used only to score.

Needs the data under data/ (docs/LENS.md, "Data for testing"); without it the
script prints the download steps and stops.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from datetime import date
from pathlib import Path

import numpy as np

from hypothesis_engine.lens import bearings, datasets, phone
from hypothesis_engine.lens import experiments as ex
from hypothesis_engine.models import FaultKind
from hypothesis_engine.physics.frequencies import bearing_multipliers
from hypothesis_engine.signals.features import (
    BEARING_SLIP_FRACTION,
    ENVELOPE_BAND_HZ,
    SPEED_PEAK_PROMINENCE,
    envelope_spectrum,
    peak_near,
)

KINDS = (
    FaultKind.HEALTHY,
    FaultKind.IMBALANCE,
    FaultKind.MISALIGNMENT,
    FaultKind.LOOSENESS,
    FaultKind.OUTER_RACE,
    FaultKind.INNER_RACE,
)
SHORT = {
    FaultKind.HEALTHY: "healthy",
    FaultKind.IMBALANCE: "imbal.",
    FaultKind.MISALIGNMENT: "misal.",
    FaultKind.LOOSENESS: "loose",
    FaultKind.OUTER_RACE: "outer",
    FaultKind.INNER_RACE: "inner",
}
BEARING_KINDS = (FaultKind.OUTER_RACE, FaultKind.INNER_RACE)
SHAFT_KINDS = (FaultKind.IMBALANCE, FaultKind.MISALIGNMENT, FaultKind.LOOSENESS)

#: Below this many cases a row's share is shown, but flagged as a small sample.
SMALL_N = 30

STEPS = """No recordings found. A person downloads them (docs/LENS.md, "Data for testing"):

  MaFaulDa, about 13 GB, licence not stated on the page (test use, no redistribution):
    mkdir -p data/mafaulda && cd data/mafaulda
    for f in normal imbalance horizontal-misalignment vertical-misalignment overhang underhang; do
      curl -O "https://www02.smt.ufrj.br/~offshore/mfs/database/mafaulda/$f.zip" && unzip -q "$f.zip" && rm "$f.zip"
    done

  Jung et al. 2023 sound, 47.2 MB, CC BY 4.0:
    download acoustic.zip from https://data.mendeley.com/datasets/ztmf3m7h5x/6, then
    mkdir -p data/jung2023/acoustic && unzip acoustic.zip -d data/jung2023/acoustic
"""


def group(rec: datasets.Recording) -> str:
    """The row a recording is scored on: its cause, and whether imbalance was added."""
    folder = rec.label.split("/")[0]
    if rec.dataset == "mafaulda" and folder in ("overhang", "underhang"):
        kind = rec.label.split("/")[1].replace("_fault", "").replace("_", " ")
        held = "" if rec.held else " (not held)"
        mass = " + imbalance" if rec.added_mass_g > 0 else ""
        return f"{kind}{mass}{held}"
    if rec.dataset == "mafaulda" and folder.endswith("-misalignment"):
        return f"misalignment ({folder.split('-')[0]})"
    return rec.truth.value.replace("_", " ") if rec.truth else rec.label


def _check(x: np.ndarray, fs: float, rec: datasets.Recording) -> dict:
    scores, note = ex.sound_experiments(x, fs, rec.rpm, rec.bearing)
    if not scores:
        return {"error": note}
    order = [a.kind for a in scores]
    return {
        "top": order[0].value,
        "cant_tell": scores[0].score - scores[1].score < ex.TIE,
        "rank": order.index(rec.truth) + 1 if rec.truth else None,
        "bearing_leads": order[0] in BEARING_KINDS,
        "scores": {a.kind.value: round(a.score, 4) for a in scores},
    }


def _lines(rec: datasets.Recording, channel: str) -> dict[str, float]:
    """Envelope prominence of each bearing line in one accelerometer channel."""
    found = bearings.lookup(rec.bearing).bearing
    assert found is not None
    m = bearing_multipliers(found.geometry)
    fr = rec.rpm / 60.0
    x = rec.channels[channel]
    f, env = envelope_spectrum(x, rec.fs)
    floor = float(np.median(env[(f > 5.0) & (f < 500.0)])) + 1e-12
    bin_hz = f[1] - f[0]
    out = {}
    for name, mult in (
        ("ftf", m["ftf"]),
        ("bpfo", m["bpfo"]),
        ("bpfi", m["bpfi"]),
        ("2xbsf", 2 * m["bsf"]),
    ):
        line = mult * fr
        out[name] = peak_near(f, env, line, BEARING_SLIP_FRACTION * line + bin_hz) / floor
    return out


def evaluate(job: tuple[str, str, str, float | None, bool, float]) -> list[dict]:
    """One file: its windows, each checked raw and through the phone emulation."""
    dataset, path, root, snr_db, label_check, fs = job
    p = Path(path)
    if dataset == "mafaulda":
        keep = ("underhang_radial", "overhang_radial") if label_check else ()
        rec = datasets.read_mafaulda(p, Path(root), fs=fs, keep=keep)
        pieces = [rec.audio]  # one 5 s file is one case
    else:
        rec = datasets.read_jung(p)
        pieces = datasets.windows(rec, ex.SOUND_SECONDS)
    out = []
    for i, x in enumerate(pieces):
        y, fs_phone = phone.emulate(x, rec.fs, snr_db=snr_db, seed=i)
        row = {
            "dataset": rec.dataset,
            "file": rec.file,
            "window": i,
            "group": group(rec),
            "truth": rec.truth.value if rec.truth else None,
            "rpm": rec.rpm,
            "fs": rec.fs,
            "name_hz": rec.name_hz,
            "raw": _check(x, rec.fs, rec),
            "phone": _check(y, fs_phone, rec),
        }
        if label_check and rec.dataset == "mafaulda" and i == 0:
            side = rec.label.split("/")[0]
            channel = f"{side}_radial" if side in ("overhang", "underhang") else "underhang_radial"
            row["lines"] = _lines(rec, channel)
        out.append(row)
    return out


def _share(k: int, n: int) -> str:
    if n == 0:
        return "-"
    flag = "*" if n < SMALL_N else ""
    return f"{100 * k / n:.0f}%{flag}"


def report(rows: list[dict], condition: str) -> list[str]:
    by: dict[str, list[dict]] = defaultdict(list)
    errors = Counter()
    for r in rows:
        c = r[condition]
        if "error" in c:
            errors[c["error"]] += 1
            continue
        by[r["group"]].append(r)
    head = "| True cause | n | " + " | ".join(SHORT[k] for k in KINDS) + " | can't tell |"
    lines = [head, "|" + "---|" * (len(KINDS) + 3)]
    for g in sorted(by, key=lambda g: (" (not held)" in g, "+" in g, g)):
        cases = by[g]
        tops = Counter(r[condition]["top"] for r in cases)
        tie = sum(r[condition]["cant_tell"] for r in cases)
        lines.append(
            f"| {g} | {len(cases)} | "
            + " | ".join(str(tops.get(k.value, 0)) for k in KINDS)
            + f" | {_share(tie, len(cases))} |"
        )
    lines.append("")
    lines.append("Bearing faults: rank of the right fault among six (1 = leads)")
    lines.append("")
    lines.append("| True cause | n | rank 1 | rank 2 | rank 3+ | median rank |")
    lines.append("|---|---|---|---|---|---|")
    for g, cases in sorted(by.items()):
        ranks = [r[condition]["rank"] for r in cases if r["truth"] in ("outer_race", "inner_race")]
        if not ranks:
            continue
        n = len(ranks)
        lines.append(
            f"| {g} | {n} | {_share(sum(x == 1 for x in ranks), n)} | "
            f"{_share(sum(x == 2 for x in ranks), n)} | {_share(sum(x >= 3 for x in ranks), n)} | "
            f"{float(np.median(ranks)):.1f} |"
        )
    held_out = {g: c for g, c in by.items() if "(not held)" in g}
    if held_out:
        lines += ["", "Causes Crux does not hold: how often a bearing fault leads anyway", ""]
        lines += ["| True cause | n | a bearing fault leads |", "|---|---|---|"]
        for g, cases in sorted(held_out.items()):
            k = sum(r[condition]["bearing_leads"] for r in cases)
            lines.append(f"| {g} | {len(cases)} | {_share(k, len(cases))} |")
    shaft = {g: c for g, c in by.items() if c[0]["truth"] in [k.value for k in SHAFT_KINDS]}
    if shaft:
        lines += ["", "Shaft faults (sound is expected to speak mainly to bearings)", ""]
        lines += ["| True cause | n | right cause leads | can't tell |", "|---|---|---|---|"]
        for g, cases in sorted(shaft.items()):
            right = sum(r[condition]["top"] == r["truth"] for r in cases)
            tie = sum(r[condition]["cant_tell"] for r in cases)
            lines.append(
                f"| {g} | {len(cases)} | {_share(right, len(cases))} | {_share(tie, len(cases))} |"
            )
    for why, k in errors.items():
        lines.append(f"\nNot checked ({k}): {why}")
    return lines


def speed_check(rows: list[dict]) -> list[str]:
    named = [r for r in rows if r.get("name_hz") and r["window"] == 0]
    if not named:
        return []
    ratios = [r["rpm"] / 60.0 / r["name_hz"] for r in named]
    p5, p50, p95 = np.percentile(ratios, [5, 50, 95])
    return [
        f"MaFaulDa speed: tachometer over file-name frequency, n = {len(ratios)}: "
        f"median {p50:.4f} (5th to 95th percentile {p5:.4f} to {p95:.4f}). "
        "1.0000 means the names were computed at the rate the loader assumes; "
        f"{named[0]['fs'] / 51_200:.4f} means they were computed at 51.2 kHz.",
    ]


def _strongest(lines: dict[str, float], names: tuple[str, ...]) -> str:
    top = max(names, key=lambda k: lines[k])
    return top if lines[top] >= SPEED_PEAK_PROMINENCE else "none"


def label_check(rows: list[dict]) -> list[str]:
    by: dict[str, list[dict[str, float]]] = defaultdict(list)
    for r in rows:
        if "lines" in r:
            by[r["group"]].append(r["lines"])
    if not by:
        return []
    names = ("ftf", "bpfo", "bpfi", "2xbsf")
    out = [
        "",
        "MaFaulDa label check: envelope of the faulty side's radial accelerometer, "
        f"{ENVELOPE_BAND_HZ[0]:.0f} to {ENVELOPE_BAND_HZ[1]:.0f} Hz band; each line's peak "
        "over the envelope median (5 to 500 Hz). Median per folder, and which line is "
        f"most often the strongest, counting a line only at {SPEED_PEAK_PROMINENCE:g} x the "
        "median or more (the bar order tracking sets for a peak; below it, noise).",
        "",
        "| Folder | n | " + " | ".join(names) + " | most often strongest |",
        "|" + "---|" * (len(names) + 3),
    ]
    for g, items in sorted(by.items()):
        med = [float(np.median([x[k] for x in items])) for k in names]
        best = Counter(_strongest(x, names) for x in items).most_common(1)[0]
        out.append(
            f"| {g} | {len(items)} | "
            + " | ".join(f"{v:.1f}" for v in med)
            + f" | {best[0]} ({_share(best[1], len(items))}) |"
        )
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--dataset", choices=("mafaulda", "jung2023", "all"), default="all")
    ap.add_argument("--snr", type=float, default=None, help="add noise in the phone emulation (dB)")
    ap.add_argument("--fs", type=float, default=datasets.MAFAULDA_FS, help="MaFaulDa sample rate")
    ap.add_argument("--limit", type=int, default=0, help="at most this many files per class folder")
    ap.add_argument("--label-check", action="store_true")
    ap.add_argument("--workers", type=int, default=0, help="processes (default: all cores)")
    ap.add_argument("--out", type=Path, default=None, help="also write the report here")
    args = ap.parse_args(argv)

    jobs = []
    if args.dataset in ("mafaulda", "all"):
        per: dict[Path, int] = defaultdict(int)
        for p in datasets.mafaulda_files():
            if args.limit and per[p.parent] >= args.limit:
                continue
            per[p.parent] += 1
            jobs.append(
                (
                    "mafaulda",
                    str(p),
                    str(datasets.MAFAULDA_DIR),
                    args.snr,
                    args.label_check,
                    args.fs,
                )
            )
    if args.dataset in ("jung2023", "all"):
        jobs += [("jung2023", str(p), "", args.snr, False, 0.0) for p in datasets.jung_files()]
    if not jobs:
        print(STEPS, file=sys.stderr)
        return 1

    if args.workers == 1:
        rows = [r for job in jobs for r in evaluate(job)]
    else:
        with ProcessPoolExecutor(max_workers=args.workers or None) as pool:
            rows = [r for chunk in pool.map(evaluate, jobs, chunksize=4) for r in chunk]

    files = len({(r["dataset"], r["file"]) for r in rows})
    noise = f", noise at {args.snr:g} dB SNR" if args.snr is not None else ""
    out = [
        f"# Lens sound check on real recordings ({date.today():%d %b %Y})",
        "",
        f"{files} recordings, {len(rows)} cases (MaFaulDa: one 5 s file per case; "
        f"Jung et al.: {ex.SOUND_SECONDS:g} s windows of each 60 s file). TIE = {ex.TIE}. "
        f"Shares marked * rest on fewer than {SMALL_N} cases.",
    ]
    for name, title in (
        ("raw", "The dataset's microphone"),
        ("phone", f"Phone emulation (48 kHz, nothing below 200 Hz{noise})"),
    ):
        out += ["", f"## {title}", ""] + report(rows, name)
    out += [""] + speed_check(rows) + label_check(rows)
    text = "\n".join(out) + "\n"
    print(text)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
