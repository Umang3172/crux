#!/usr/bin/env python3
"""Build the health tables, compare the forecasters, train the shipped model.

    uv run python scripts/forecast.py table      # raw snapshots -> data/forecast/*.csv (slow, once)
    uv run python scripts/forecast.py evaluate   # leave-one-bearing-out on XJTU-SY, then IMS
    uv run python scripts/forecast.py train      # fit on all XJTU-SY -> data/forecast/model.pkl
    uv run python scripts/forecast.py replay     # what the maintenance screen shows -> replay.json
    uv run python scripts/forecast.py metro      # the watcher on MetroPT-3's air compressor
    uv run python scripts/forecast.py timesfm    # Google's TimesFM in BigQuery, same test
    uv run python scripts/forecast.py calibrate  # ranges widened on held-out bearings, same test

Needs the run-to-failure data a human downloaded into data/xjtu/ and data/ims/
(docs/FORECAST.md). Only `timesfm` touches the network: it needs Google Cloud's
login and the timesfm extra. Results land in data/forecast/, which git ignores:
they are derived from data we do not redistribute.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime

from hypothesis_engine.forecast import health, metropt, replay, runs
from hypothesis_engine.forecast.calibrate import Calibrated
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
    "gbm-residual-calibrated": lambda: Calibrated(lambda: QuantileGBM("residual")),
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

    built = health.build_many(found, progress)
    for h in built:
        if h.extra.get("damaged_files"):
            print(f"  {h.run_id}: left out unreadable {h.extra['damaged_files']}")
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
    if args.calibrated:
        model = Calibrated(lambda: QuantileGBM(args.target))
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
    machines = replay.with_record(machines)
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
    fixed = metropt.limit(h.signal, h.hour)
    lines = [
        "The bearing watcher's rules on MetroPT-3 (air compressor, air leaks)",
        "",
        f"Signal: loaded share over the last {metropt.WINDOW_H} h. Healthy month: mean "
        f"{h.signal[h.hour < metropt.BASELINE_END].mean():.3f}; fixed alarm line {fixed:.3f}.",
    ]
    for label, line in (
        ("Normal = the first month (fixed)", fixed),
        (
            f"Normal = its own last {metropt.ROLL_DAYS} days, the latest "
            f"{metropt.GAP_H} h and flagged hours left out (rolling)",
            metropt.rolling_limits(h.signal, h.hour),
        ),
    ):
        verdicts, false, months = metropt.score(h, line)
        lines += [
            "",
            f"**{label}**",
            "",
            "| failure window | warned before it began | hours of warning (negative: during it) |",
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


def cmd_timesfm(args: argparse.Namespace) -> int:
    """TimesFM beside the trend and the shipped model, on the same held-out bearings.

    TimesFM learns nothing from our bearings, so on IMS it is the same model as
    on XJTU-SY; the learned model is trained on XJTU-SY and tested on IMS.
    """
    from hypothesis_engine.forecast.timesfm import TimesFMForecaster

    if not TABLES["xjtu"].exists():
        print("no xjtu health table: run `table --dataset xjtu` first", file=sys.stderr)
        return 1
    xjtu = [h for h in _load("xjtu") if h.failed]
    ims = [h for h in _load("ims") if h.failed] if TABLES["ims"].exists() else []
    methods: dict = {
        "trend": TrendExtrapolation,
        "gbm-residual": lambda: QuantileGBM("residual"),
    }
    for model in args.models:
        for signal in args.signals:
            methods[TimesFMForecaster(model, signal, query=lambda *a: {}).name] = (
                lambda m=model, s=signal: TimesFMForecaster(m, s)
            )
    report: dict = {"generated": datetime.now(UTC).isoformat(timespec="seconds"), "methods": {}}
    head = "| method | bearings scored | median error / life after alarm | inside p10-p90 (aim 80%) | p10 too late |"
    rule = "|---|---|---|---|---|"
    loo_lines = [f"Leave one bearing out on XJTU-SY ({len(xjtu)} failed bearings)", "", head, rule]
    ims_lines = ["IMS: trained on XJTU-SY where there is training; TimesFM as is", "", head, rule]
    per_run: dict[str, dict[str, float | None]] = {}
    for name, make in methods.items():
        print(f"{name}: XJTU-SY", flush=True)
        loo = leave_one_out(xjtu, make)
        s = summarise(loo)
        entry = {"xjtu": {"summary": s.__dict__, "runs": as_records(loo)}}
        loo_lines.append(
            f"| {name} | {s.runs_scored} | {_fmt(s.norm_error)} | {_fmt(s.coverage, True)} | {_fmt(s.late, True)} |"
        )
        for r in loo:
            per_run.setdefault(r.run_id, {})[name] = r.norm_error
        if ims:
            print(f"{name}: IMS", flush=True)
            tr = transfer(xjtu, ims, make)
            t = summarise(tr)
            entry["ims"] = {"summary": t.__dict__, "runs": as_records(tr)}
            ims_lines.append(
                f"| {name} | {t.runs_scored} | {_fmt(t.norm_error)} | {_fmt(t.coverage, True)} | {_fmt(t.late, True)} |"
            )
        report["methods"][name] = entry
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / f"results_timesfm{args.tag}.json").write_text(json.dumps(report, indent=2))
    names = list(methods)
    run_lines = [
        "Median error / life after alarm, per XJTU-SY bearing",
        "",
        "| bearing | " + " | ".join(names) + " |",
        "|---|" + "---|" * len(names),
    ]
    for run_id in sorted(per_run):
        run_lines.append(
            f"| {run_id} | " + " | ".join(_fmt(per_run[run_id].get(n)) for n in names) + " |"
        )
    text = "\n".join([*loo_lines, "", *(ims_lines if ims else []), "", *run_lines])
    (OUT / f"results_timesfm{args.tag}.md").write_text(text + "\n")
    print(text)
    print(f"\nwrote {OUT}/results_timesfm{args.tag}.{{json,md}}")
    return 0


def cmd_calibrate(args: argparse.Namespace) -> int:
    """Each forecaster beside its calibrated self, on the same held-out bearings.

    Calibration is fitted inside each fold, on the training bearings only, so
    the held-out bearing never sets its own correction.
    """
    if not TABLES["xjtu"].exists():
        print("no xjtu health table: run `table --dataset xjtu` first", file=sys.stderr)
        return 1
    xjtu = [h for h in _load("xjtu") if h.failed]
    ims = [h for h in _load("ims") if h.failed] if TABLES["ims"].exists() else []
    trend_cache: dict = {}
    methods: dict = {
        "trend": TrendExtrapolation,
        "trend-calibrated": lambda: Calibrated(TrendExtrapolation, learns=False, cache=trend_cache),
        "gbm-residual": lambda: QuantileGBM("residual"),
        "gbm-residual-calibrated": lambda: Calibrated(lambda: QuantileGBM("residual")),
    }
    head = "| method | split | bearings scored | median error / life after alarm | inside p10-p90 (aim 80%) | p10 too late |"
    lines = [f"Calibrated ranges, XJTU-SY one bearing held out ({len(xjtu)} failed)", "", head]
    lines.append("|---|---|---|---|---|---|")
    report: dict = {"generated": datetime.now(UTC).isoformat(timespec="seconds"), "methods": {}}
    for name, make in methods.items():
        print(f"{name}: XJTU-SY", flush=True)
        loo = leave_one_out(xjtu, make)
        s = summarise(loo)
        entry = {"xjtu": {"summary": s.__dict__, "runs": as_records(loo)}}
        lines.append(
            f"| {name} | XJTU-SY, one held out | {s.runs_scored} | {_fmt(s.norm_error)} | {_fmt(s.coverage, True)} | {_fmt(s.late, True)} |"
        )
        if ims:
            print(f"{name}: IMS", flush=True)
            tr = transfer(xjtu, ims, make)
            t = summarise(tr)
            entry["ims"] = {"summary": t.__dict__, "runs": as_records(tr)}
            lines.append(
                f"| {name} | trained on XJTU-SY, tested on IMS | {t.runs_scored} | {_fmt(t.norm_error)} | {_fmt(t.coverage, True)} | {_fmt(t.late, True)} |"
            )
        report["methods"][name] = entry
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "results_calibrated.json").write_text(json.dumps(report, indent=2))
    text = "\n".join(lines)
    (OUT / "results_calibrated.md").write_text(text + "\n")
    print(text)
    print(f"\nwrote {OUT}/results_calibrated.{{json,md}}")
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
    tr.add_argument(
        "--calibrated", action="store_true", help="widen its ranges on held-out bearings"
    )
    tr.set_defaults(func=cmd_train)
    rp = sub.add_parser("replay", help="precompute the maintenance screen's replays")
    rp.add_argument("--method", choices=list(METHODS), default="gbm-residual-calibrated")
    rp.set_defaults(func=cmd_replay)
    mt = sub.add_parser("metro", help="the watcher on MetroPT-3's air compressor")
    mt.set_defaults(func=cmd_metro)
    tf = sub.add_parser("timesfm", help="Google's TimesFM in BigQuery on the same held-out test")
    tf.add_argument("--models", nargs="+", default=["TimesFM 2.5", "TimesFM 3.0"])
    tf.add_argument("--signals", nargs="+", default=["peak", "ratchet"])
    tf.add_argument("--tag", default="", help="suffix for the result files, to run settings apart")
    tf.set_defaults(func=cmd_timesfm)
    ca = sub.add_parser("calibrate", help="ranges widened on held-out bearings, same test")
    ca.set_defaults(func=cmd_calibrate)
    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
