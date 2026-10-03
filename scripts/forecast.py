#!/usr/bin/env python3
"""Build the health tables, compare the forecasters, train the shipped model.

    uv run python scripts/forecast.py table      # raw snapshots -> data/forecast/*.csv (slow, once)
    uv run python scripts/forecast.py evaluate   # leave-one-bearing-out on XJTU-SY, then IMS
    uv run python scripts/forecast.py train      # fit on all XJTU-SY -> data/forecast/model.pkl

Needs the run-to-failure data a human downloaded into data/xjtu/ and data/ims/
(docs/FORECAST.md). Touches no network. Results land in data/forecast/, which
git ignores: they are derived from data we do not redistribute.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime

from hypothesis_engine.forecast import health, runs
from hypothesis_engine.forecast.evaluate import as_records, leave_one_out, summarise, transfer
from hypothesis_engine.forecast.models import (
    DEFAULT_MODEL,
    AverageLife,
    QuantileGBM,
    TrendExtrapolation,
)

OUT = runs.DATA_ROOT / "forecast"
TABLES = {"xjtu": OUT / "health_xjtu.csv", "ims": OUT / "health_ims.csv"}

METHODS = {
    "average-life": AverageLife,
    "trend": TrendExtrapolation,
    "gbm-direct": lambda: QuantileGBM("direct"),
    "gbm-residual": lambda: QuantileGBM("residual"),
}


def _table(name: str) -> None:
    found = runs.xjtu_runs() if name == "xjtu" else runs.ims_runs(include_censored=True)
    if not found:
        print(f"{name}: nothing under {runs.XJTU_DIR if name == 'xjtu' else runs.IMS_DIR}")
        return
    built = []
    for k, run in enumerate(found, 1):
        print(f"{name} {k}/{len(found)} {run.run_id}: {len(run)} snapshots", flush=True)
        built.append(health.build(run))
    health.save(built, TABLES[name])
    print(f"wrote {TABLES[name]}")


def cmd_table(args: argparse.Namespace) -> int:
    for name in ("xjtu", "ims") if args.dataset == "all" else (args.dataset,):
        _table(name)
    return 0


def _fmt(v: float | None, pct: bool = False) -> str:
    if v is None:
        return "n/a"
    return f"{v:.0%}" if pct else f"{v:.2f}"


def cmd_evaluate(args: argparse.Namespace) -> int:
    if not TABLES["xjtu"].exists():
        print("no XJTU-SY health table: run `table` first", file=sys.stderr)
        return 1
    xjtu = health.load(TABLES["xjtu"])
    ims = [h for h in health.load(TABLES["ims"]) if h.failed] if TABLES["ims"].exists() else []
    report: dict = {
        "generated": datetime.now(UTC).isoformat(timespec="seconds"),
        "xjtu_runs": len(xjtu),
        "ims_runs": len(ims),
        "leave_one_out": {},
        "transfer_to_ims": {},
    }
    lines = [
        "| method | split | bearings scored | median error / life after onset | inside p10-p90 (aim 80%) | p10 too late |",
        "|---|---|---|---|---|---|",
    ]
    for name, make in METHODS.items():
        loo = leave_one_out(xjtu, make)
        s = summarise(loo)
        report["leave_one_out"][name] = {"summary": s.__dict__, "runs": as_records(loo)}
        lines.append(
            f"| {name} | XJTU-SY, one bearing held out | {s.runs_scored} | {_fmt(s.norm_error)} | {_fmt(s.coverage, True)} | {_fmt(s.late, True)} |"
        )
        if ims:
            tr = transfer(xjtu, ims, make)
            t = summarise(tr)
            report["transfer_to_ims"][name] = {"summary": t.__dict__, "runs": as_records(tr)}
            lines.append(
                f"| {name} | trained on XJTU-SY, tested on IMS | {t.runs_scored} | {_fmt(t.norm_error)} | {_fmt(t.coverage, True)} | {_fmt(t.late, True)} |"
            )
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "results.json").write_text(json.dumps(report, indent=2))
    table = "\n".join(lines)
    (OUT / "results.md").write_text(table + "\n")
    print(table)
    print(f"\nwrote {OUT / 'results.json'} and {OUT / 'results.md'}")
    return 0


def cmd_train(args: argparse.Namespace) -> int:
    if not TABLES["xjtu"].exists():
        print("no XJTU-SY health table: run `table` first", file=sys.stderr)
        return 1
    model = QuantileGBM(args.target)
    model.fit(health.load(TABLES["xjtu"]))
    model.save(DEFAULT_MODEL)
    print(f"wrote {DEFAULT_MODEL} ({model.name})")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("table", help="summarise raw snapshots into health tables")
    t.add_argument("--dataset", choices=["xjtu", "ims", "all"], default="all")
    t.set_defaults(func=cmd_table)
    e = sub.add_parser("evaluate", help="compare every forecaster on held-out bearings")
    e.set_defaults(func=cmd_evaluate)
    tr = sub.add_parser("train", help="fit the shipped model on all of XJTU-SY")
    tr.add_argument("--target", choices=["direct", "residual"], default="residual")
    tr.set_defaults(func=cmd_train)
    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
