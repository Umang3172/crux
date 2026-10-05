#!/usr/bin/env python3
"""Build the health tables, compare the forecasters, train the shipped model.

    uv run python scripts/forecast.py table      # raw snapshots -> data/forecast/*.csv (slow, once)
    uv run python scripts/forecast.py evaluate   # leave-one-bearing-out on XJTU-SY, then IMS
    uv run python scripts/forecast.py train      # fit on all XJTU-SY -> data/forecast/model.pkl
    uv run python scripts/forecast.py replay     # what the maintenance screen shows -> replay.json
    uv run python scripts/forecast.py metro      # the watcher on MetroPT-3's air compressor

Needs the run-to-failure data a human downloaded into data/xjtu/ and data/ims/
(docs/FORECAST.md). Touches no network. Results land in data/forecast/, which
git ignores: they are derived from data we do not redistribute.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime

from hypothesis_engine.forecast import health, metropt, replay, runs
from hypothesis_engine.forecast.evaluate import as_records, leave_one_out, summarise, transfer
from hypothesis_engine.forecast.models import (
    DEFAULT_MODEL,
    AverageLife,
    QuantileGBM,
    TrendExtrapolation,
    onset_of,
)
from hypothesis_engine.forecast.percent import health_percent

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
    print(f"{name}: {len(found)} bearings", flush=True)

    def progress(run_id: str, i: int, n: int) -> None:
        if i == n or i % 500 == 0:
            print(f"  {run_id}: {i}/{n} snapshots", flush=True)

    health.save(health.build_many(found, progress), TABLES[name])
    print(f"wrote {TABLES[name]}")


def cmd_table(args: argparse.Namespace) -> int:
    for name in ("xjtu", "ims") if args.dataset == "all" else (args.dataset,):
        _table(name)
    return 0


def _fmt(v: float | None, pct: bool = False) -> str:
    if v is None:
        return "n/a"
    return f"{v:.0%}" if pct else f"{v:.2f}"


def _load(name: str) -> list[health.RunHealth]:
    """A health table with snapshots taken after the machine stopped removed."""
    return [health.trim_stopped(h) for h in health.load(TABLES[name])]


def _watcher_lines(runs_: list[health.RunHealth]) -> list[str]:
    lines = [
        "| bearing | outcome | ran (h) | watcher fired at (h) | warning before the end (h) |",
        "|---|---|---|---|---|",
    ]
    for h in sorted(runs_, key=lambda h: h.run_id):
        o = onset_of(h)
        fired = f"{h.t[o] / 60:.1f}" if o is not None else "never"
        lead = f"{(h.t_end - h.t[o]) / 60:.1f}" if o is not None else "-"
        outcome = f"failed: {h.failure_mode}" if h.failed else "survived the test"
        lines.append(f"| {h.run_id} | {outcome} | {h.t_end / 60:.1f} | {fired} | {lead} |")
    return lines


#: Hours before the end at which the percent is reported.
PERCENT_HOURS = (24.0, 5.0, 1.0, 0.25)


def _percent_lines(runs_: list[health.RunHealth]) -> list[str]:
    """What the health percent read before each failure. A dash: the run was shorter."""
    heads = " | ".join(f"{x:g} h before" for x in PERCENT_HOURS)
    lines = [
        f"| bearing | outcome | 90% or more for (share of life) | at the alarm | {heads} | at the end |",
        "|---|---|---|---|" + "---|" * len(PERCENT_HOURS) + "---|",
    ]
    for h in sorted(runs_, key=lambda h: h.run_id):
        p = health_percent(h)
        left_h = (h.t_end - h.t) / 60
        at = [f"{p[left_h <= x][0]:.0f}%" if left_h[0] > x else "-" for x in PERCENT_HOURS]
        o = onset_of(h)
        alarm = f"{p[o]:.0f}%" if o is not None else "no alarm"
        outcome = f"failed: {h.failure_mode}" if h.failed else "survived the test"
        lines.append(
            f"| {h.run_id} | {outcome} | {(p >= 90).mean():.0%} | {alarm} | {' | '.join(at)} | {p[-1]:.0f}% |"
        )
    return lines


def cmd_evaluate(args: argparse.Namespace) -> int:
    name = args.dataset
    if not TABLES[name].exists():
        print(f"no {name} health table: run `table --dataset {name}` first", file=sys.stderr)
        return 1
    every = _load(name)
    scored = [h for h in every if h.failed]
    other = "ims" if name == "xjtu" else None
    test = [h for h in _load(other) if h.failed] if other and TABLES[other].exists() else []
    report: dict = {
        "generated": datetime.now(UTC).isoformat(timespec="seconds"),
        "dataset": name,
        "bearings": len(every),
        "failed_bearings": len(scored),
        "leave_one_out": {},
        "transfer_to_ims": {},
    }
    lines = [
        f"Leave one bearing out on {name} ({len(scored)} failed bearings)",
        "",
        "| method | split | bearings scored | median error / life after alarm | inside p10-p90 (aim 80%) | p10 too late |",
        "|---|---|---|---|---|---|",
    ]
    for method, make in METHODS.items():
        loo = leave_one_out(scored, make)
        s = summarise(loo)
        report["leave_one_out"][method] = {"summary": s.__dict__, "runs": as_records(loo)}
        lines.append(
            f"| {method} | {name}, one bearing held out | {s.runs_scored} | {_fmt(s.norm_error)} | {_fmt(s.coverage, True)} | {_fmt(s.late, True)} |"
        )
        if test:
            tr = transfer(scored, test, make)
            t = summarise(tr)
            report["transfer_to_ims"][method] = {"summary": t.__dict__, "runs": as_records(tr)}
            lines.append(
                f"| {method} | trained on {name}, tested on IMS | {t.runs_scored} | {_fmt(t.norm_error)} | {_fmt(t.coverage, True)} | {_fmt(t.late, True)} |"
            )
    lines += ["", f"Watcher on every {name} bearing (running hours)", "", *_watcher_lines(every)]
    lines += ["", f"Health percent on every {name} bearing", "", *_percent_lines(every)]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"results_{name}.json").write_text(json.dumps(report, indent=2))
    text = "\n".join(lines)
    (OUT / f"results_{name}.md").write_text(text + "\n")
    print(text)
    print(f"\nwrote {OUT / f'results_{name}.json'} and {OUT / f'results_{name}.md'}")
    return 0


def cmd_train(args: argparse.Namespace) -> int:
    if not TABLES["xjtu"].exists():
        print("no XJTU-SY health table: run `table` first", file=sys.stderr)
        return 1
    model = QuantileGBM(args.target)
    model.fit(_load("xjtu"))
    model.save(DEFAULT_MODEL)
    print(f"wrote {DEFAULT_MODEL} ({model.name})")
    return 0


def cmd_replay(args: argparse.Namespace) -> int:
    found = replay.available_runs()
    if not found:
        print("no health tables: run `table` first", file=sys.stderr)
        return 1
    machines = replay.build_all(found, replay.held_out(METHODS[args.method], found))
    replay.save(machines)
    print(
        f"wrote {replay.REPLAY_FILE}: {len(machines)} machines, {args.method}, each part held out"
    )
    return 0


def cmd_metro(args: argparse.Namespace) -> int:
    if not metropt.METRO_CSV.exists():
        print(f"no MetroPT-3 CSV at {metropt.METRO_CSV}", file=sys.stderr)
        return 1
    h = metropt.hourly()
    line = metropt.limit(h.signal, h.hour)
    verdicts, false, months = metropt.score(h, line)
    lines = [
        "The bearing watcher's frozen rules on MetroPT-3 (air compressor, air leaks)",
        "",
        f"Signal: loaded share over the last {metropt.WINDOW_H} h. Healthy month: mean "
        f"{h.signal[h.hour < metropt.BASELINE_END].mean():.3f}; alarm line {line:.3f}.",
        "",
        "| failure window | warned before it began | hours of warning (negative: the alarm came during it) |",
        "|---|---|---|",
    ]
    for v in verdicts:
        lead = f"{v.lead_h:.0f}" if v.lead_h is not None else "-"
        lines.append(
            f"| {v.failure[0]} to {v.failure[1]} | {'yes' if v.warned else 'no'} | {lead} |"
        )
    lines += [
        "",
        f"Alarms that warned of nothing: {len(false)} in {months:.1f} months "
        f"({len(false) / months:.1f} a month).",
    ]
    OUT.mkdir(parents=True, exist_ok=True)
    text = "\n".join(lines)
    (OUT / "results_metropt.md").write_text(text + "\n")
    print(text)
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
    e.add_argument("--dataset", choices=["xjtu", "ims"], default="xjtu")
    e.set_defaults(func=cmd_evaluate)
    tr = sub.add_parser("train", help="fit the shipped model on all of XJTU-SY")
    tr.add_argument("--target", choices=["direct", "residual"], default="residual")
    tr.set_defaults(func=cmd_train)
    rp = sub.add_parser("replay", help="precompute the maintenance screen's replays")
    rp.add_argument("--method", choices=list(METHODS), default="gbm-residual")
    rp.set_defaults(func=cmd_replay)
    mt = sub.add_parser("metro", help="the watcher on MetroPT-3's air compressor")
    mt.set_defaults(func=cmd_metro)
    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
