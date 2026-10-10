#!/usr/bin/env python3
"""Score the photo check on labelled photos.

    OLLAMA_MODEL=gemma4:latest uv run python scripts/photo_eval.py
    uv run python scripts/photo_eval.py --folder data/cameras:normal   # a folder of one label
    uv run python scripts/photo_eval.py --calibrate                   # gate thresholds from the calibration split

Layout: `data/photo_eval/<label>/*.jpg`, where <label> is `normal` or checklist
items joined by `+` (`leak`, `leak+corrosion`; ids in `ticket.camera.ITEMS`).
An optional `data/photo_eval/pairs.csv` gives a reference photo for test photos:

    machine,reference,test_image,true_items
    pump-3,normal/pump3_a.jpg,leak/pump3_b.jpg,leak

Every test photo goes through `camera.inspect`, the call a ticket and a Lens scan
make: once without a reference, and once with its reference when pairs.csv has
one. Each run is read twice, after the first look (`CameraLook.checklist`) and
after the second (`CameraLook.findings`), so one model call gives both.

Per checklist item: hits and misses on photos labelled with it, unsure and cannot
see, false alarms on normal photos, and retakes. n is printed for everything.

A fixed 20% of photos, chosen by a hash of their path, is the calibration split.
It is never scored; `--calibrate` derives the quality gate's bars from it (the
bar each measure must clear to keep 99% of those photos) and prints them for a
person to commit with a row in docs/LENS.md. Fewer than 30 calibration photos
give no recommendation.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path

import numpy as np

from hypothesis_engine.forecast.runs import DATA_ROOT
from hypothesis_engine.ticket import camera, photo

ROOT = DATA_ROOT / "photo_eval"
OUT = DATA_ROOT / "lens_eval"
IMAGES = (".jpg", ".jpeg", ".png")

#: Share of photos held out to set the gate's bars, never scored.
CALIBRATION_SHARE = 0.20

#: The gate keeps this share of calibration photos (they are usable photos).
KEEP = 0.99

#: Fewer calibration photos than this give no recommended bars.
MIN_CALIBRATION = 30

#: Below this many cases a share is shown but flagged.
SMALL_N = 30

CONTEXT = "a photo of an industrial machine, taken to check its condition"


@dataclass(frozen=True)
class Photo:
    path: Path
    name: str  # as printed: relative to its folder's root
    labels: frozenset[str]  # checklist items it shows; empty means normal

    @property
    def calibration(self) -> bool:
        digest = hashlib.sha1(self.name.encode()).digest()
        return digest[0] < CALIBRATION_SHARE * 256


def parse_label(text: str) -> frozenset[str]:
    if text == "normal":
        return frozenset()
    items = frozenset(t.strip() for t in text.split("+") if t.strip())
    unknown = items - set(camera.ITEMS)
    if unknown:
        raise ValueError(f"unknown checklist item(s) {sorted(unknown)}; known: {camera.ITEMS}")
    return items


def collect(root: Path) -> list[Photo]:
    """Photos under root/<label>/ (any depth below the label folder)."""
    out = []
    if not root.exists():
        return out
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        labels = parse_label(folder.name)
        for p in sorted(folder.rglob("*")):
            if p.suffix.lower() in IMAGES:
                out.append(Photo(p, p.relative_to(root).as_posix(), labels))
    return out


def from_folder(spec: str) -> list[Photo]:
    """`path:label`: every image under path, all with one label."""
    path, _, label = spec.rpartition(":")
    base = Path(path)
    labels = parse_label(label)
    return [
        Photo(p, f"{base.name}/{p.relative_to(base).as_posix()}", labels)
        for p in sorted(base.rglob("*"))
        if p.suffix.lower() in IMAGES
    ]


def read_pairs(root: Path) -> dict[str, Path]:
    """test image name -> reference path, from root/pairs.csv."""
    f = root / "pairs.csv"
    if not f.exists():
        return {}
    with f.open() as fh:
        return {row["test_image"]: root / row["reference"] for row in csv.DictReader(fh)}


def _still(p: Path, label: str) -> camera.Still:
    mime = "image/png" if p.suffix.lower() == ".png" else "image/jpeg"
    return camera.Still("eval", label, p.read_bytes(), mime, "")


def run(photo_: Photo, inspector: camera.Inspector, reference: Path | None) -> dict:
    ref = _still(reference, "reference (normal)") if reference else None
    look = camera.inspect(
        _still(photo_.path, photo_.name), CONTEXT, inspector, reference=ref, use_registry=False
    )
    first = {f.item: f.status for f in look.checklist if f.item}
    kept = {f.item for f in look.findings if f.item}
    return {
        "photo": photo_.name,
        "labels": sorted(photo_.labels),
        "reference": reference.name if reference else None,
        "retake": look.retake,
        "first": first,
        "kept": sorted(kept),
        "dropped": look.dropped,
        "zooms": look.zooms,
        "note": look.note,
        "checklist": [asdict(f) for f in look.checklist],
    }


def _share(k: int, n: int) -> str:
    if n == 0:
        return "-"
    return f"{k}/{n}" + (" *" if n < SMALL_N else "")


def table(results: list[dict], after: str) -> list[str]:
    """Per item: hits, misses, unsure, cannot see on positives; false alarms on normal photos."""
    looked = [r for r in results if not r["retake"]]
    normal = [r for r in looked if not r["labels"]]
    lines = [
        "| Item | photos with it | hit | miss | unsure | cannot see | false alarm on normal |",
        "|---|---|---|---|---|---|---|",
    ]
    for item in camera.ITEMS:
        pos = [r for r in looked if item in r["labels"]]

        def status(r: dict, item: str = item) -> str:
            s = r["first"].get(item, "unsure")
            if after == "second" and s == "present" and item not in r["kept"]:
                return "dropped"
            return s

        hit = sum(status(r) == "present" for r in pos)
        miss = sum(status(r) in ("absent", "dropped") for r in pos)
        unsure = sum(status(r) == "unsure" for r in pos)
        blind = sum(status(r) == "cannot_see" for r in pos)
        alarm = sum(status(r) == "present" for r in normal)
        lines.append(
            f"| {camera.LABELS[item]} | {len(pos)} | {_share(hit, len(pos))} | "
            f"{_share(miss, len(pos))} | {_share(unsure, len(pos))} | {_share(blind, len(pos))} | "
            f"{_share(alarm, len(normal))} |"
        )
    return lines


def report(results: list[dict], model: str, source: str) -> list[str]:
    out = [
        f"# Photo check scored ({date.today():%d %b %Y})",
        "",
        f"Model: `{model}`. Photos: {source}. Shares are counts over n; * marks n < {SMALL_N}.",
    ]
    for cond, title in (
        (False, "Without a reference photo"),
        (True, "With the normal photo beside it"),
    ):
        rows = [r for r in results if (r["reference"] is not None) == cond]
        if not rows:
            continue
        retakes = sum(bool(r["retake"]) for r in rows)
        dropped = sum(r["dropped"] for r in rows)
        out += [
            "",
            f"## {title}",
            "",
            f"{len(rows)} looks; retake asked on {_share(retakes, len(rows))}; "
            f"{dropped} first-look finding(s) dropped by the second look.",
        ]
        for after, name in (("first", "After the first look"), ("second", "After the second look")):
            out += ["", f"### {name}", ""] + table(rows, after)
    return out


def calibrate(photos: list[Photo]) -> list[str]:
    cal = [p for p in photos if p.calibration]
    qs = [photo.quality(p.path.read_bytes()) for p in cal]
    qs = [q for q in qs if q.measured]
    out = [f"Calibration split: {len(qs)} photos (of {len(photos)})."]
    if len(qs) < MIN_CALIBRATION:
        out.append(
            f"Fewer than {MIN_CALIBRATION}: no recommendation; the provisional bars stay "
            f"(MIN_SHARPNESS {photo.MIN_SHARPNESS:g}, DARK_P99 {photo.DARK_P99:g}, "
            f"BRIGHT_P1 {photo.BRIGHT_P1:g})."
        )
        return out
    lo = (1 - KEEP) * 100
    out += [
        f"Bars that keep {KEEP:.0%} of them (commit with a row in docs/LENS.md):",
        f"  MIN_SHARPNESS = {np.percentile([q.sharpness for q in qs], lo):.0f}",
        f"  DARK_P99 = {np.percentile([q.p99 for q in qs], lo):.0f}",
        f"  BRIGHT_P1 = {np.percentile([q.p1 for q in qs], 100 - lo):.0f}",
    ]
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--root", type=Path, default=ROOT)
    ap.add_argument(
        "--folder", action="append", default=[], help="path:label, a folder of one label"
    )
    ap.add_argument("--calibrate", action="store_true")
    ap.add_argument("--out", type=Path, default=None, help="report file (default data/lens_eval/)")
    args = ap.parse_args(argv)

    photos = collect(args.root)
    for spec in args.folder:
        photos += from_folder(spec)
    if not photos:
        print(
            f"No photos under {args.root}. Put them in <root>/<label>/, label 'normal' or "
            f"items joined by '+' from {', '.join(camera.ITEMS)}.",
            file=sys.stderr,
        )
        return 1
    if args.calibrate:
        print("\n".join(calibrate(photos)))
        return 0

    inspector = camera.get_inspector()
    if inspector.name == camera.NOBODY:
        print(
            "No model is on: set OLLAMA_MODEL, or a Gemini key, to score a model.", file=sys.stderr
        )
        return 1
    pairs = read_pairs(args.root)
    test = [p for p in photos if not p.calibration]
    results = []
    for i, p in enumerate(test, 1):
        print(f"[{i}/{len(test)}] {p.name}", file=sys.stderr)
        results.append(run(p, inspector, None))
        if p.name in pairs:
            results.append(run(p, inspector, pairs[p.name]))

    held = len(photos) - len(test)
    places = {s.rpartition(":")[0] for s in args.folder} | (
        {str(args.root)} if args.root.exists() else set()
    )
    source = (
        f"{len(test)} scored ({sum(not p.labels for p in test)} normal), "
        f"{held} held out for calibration, from {', '.join(sorted(places))}"
    )
    text = "\n".join(report(results, inspector.name, source)) + "\n"
    print(text)
    out = args.out or OUT / f"photo_{inspector.name.replace(':', '_')}_{date.today():%Y%m%d}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    out.with_suffix(".json").write_text(json.dumps(results, indent=1, default=str))
    print(f"written: {out} and {out.with_suffix('.json').name}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
