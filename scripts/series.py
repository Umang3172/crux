#!/usr/bin/env python3
"""Build what the Trends tab shows.

    uv run python scripts/series.py prepare                    # raw compressor file -> data/series/*.csv (once)
    uv run python scripts/series.py snapshot --engine offline  # the stand-ins, no network
    uv run python scripts/series.py snapshot --engine bigquery --dry-run   # print what each job may cost
    uv run python scripts/series.py snapshot --engine bigquery             # the Google run
    uv run python scripts/series.py spent                      # what the Google run has cost so far
    uv run python scripts/series.py recount                    # count saved weeks' unusual readings again, no network
    uv run python scripts/series.py early                      # does the record show a leak before it is reported?

`prepare` needs MetroPT-3 in data/metropt/ (a human download; docs/SERIES.md).
The Google run needs the `series` extra and Google Cloud's login (ADC), uses
GOOGLE_CLOUD_PROJECT and BIGQUERY_LOCATION (default asia-south1), and stops
before any job that would take its ledger past the budget in series/settings.py.
"""

from __future__ import annotations

import argparse
import sys

from hypothesis_engine.series import bigquery, settings, snapshot, sources


def prepare(_: argparse.Namespace) -> int:
    for cadence, path in sources.prepare().items():
        what = f"{cadence}-minute means" if cadence else "bearing health"
        print(f"{what}: {path}")
    return 0


def snap(args: argparse.Namespace) -> int:
    if args.engine == "offline":
        n = 0
        for source, views in snapshot.VIEWS.items():
            for p in settings.presets(source):
                for view in views:
                    try:
                        snapshot.save("offline", snapshot.build_offline(source, p, view))
                        n += 1
                    except snapshot.NotAvailable as exc:
                        print(f"  {source}/{p.id}/{view}: skipped ({exc})")
        print(f"{n} offline views in {settings.SNAPSHOT_DIR / 'offline'}")
        return 0
    steps = args.steps.split(",") if args.steps else bigquery.STEPS
    unknown = set(steps) - set(bigquery.STEPS)
    if unknown:
        print(f"unknown steps {sorted(unknown)}; choose from {bigquery.STEPS}", file=sys.stderr)
        return 2
    runner = bigquery.Runner(dry_only=args.dry_run, budget=args.budget)
    print(
        f"project {runner.where.project}, dataset {runner.where.dataset}, location {runner.location}"
    )
    try:
        written = bigquery.run(runner, steps)
    except bigquery.BudgetExceeded as exc:
        print(f"stopped: {exc}", file=sys.stderr)
        return 3
    if args.dry_run:
        print(
            f"dry run: this run would cost at most ${runner.planned:.4f}; spent before it ${runner.ledger.spent():.4f}"
        )
    else:
        print(f"{len(written)} BigQuery views written; spent in all ${runner.ledger.spent():.4f}")
    return 0


def recount(_: argparse.Namespace) -> int:
    for engine in snapshot.ENGINES:
        for path in snapshot.recount(engine):
            print(f"  {path}")
    return 0


def early(_: argparse.Namespace) -> int:
    """The share of running minutes spent loaded, by day before each leak and by hour on its day.

    Read straight from the one-minute table, no model: a minute runs when the
    motor draws at least OFF_BELOW_A and was not filled, and is loaded when the
    compressor was loaded for most of it. A day counts when the motor ran an hour.
    """
    import numpy as np

    t = sources.metro(1)
    on = (t.cols["motor_current"] >= settings.OFF_BELOW_A) & ~t.filled
    loaded = on & (t.cols["loaded"] > 50)

    def share(a: np.datetime64, b: np.datetime64, least: int) -> str:
        i, j = t.index(a), t.index(b)
        n = int(on[i:j].sum())
        return "  -" if n < least else f"{100 * loaded[i:j].sum() / n:3.0f}"

    day, hour = np.timedelta64(1, "D"), np.timedelta64(1, "h")
    a = np.datetime64(settings.preset("metro", "normal").as_of, "D")
    print(
        "normal week, by day:",
        " ".join(share(d, d + day, 60) for d in np.arange(a - 7 * day, a, day)),
    )
    for f in sources.metro_failures():
        start = np.datetime64(f["start"], "m")
        d0 = start.astype("datetime64[D]")
        days = " ".join(share(d, d + day, 60) for d in np.arange(d0 - 10 * day, d0 + day, day))
        h0 = start.astype("datetime64[h]")
        hours = " ".join(
            share(h, h + hour, 20) for h in np.arange(h0 - 12 * hour, h0 + 3 * hour, hour)
        )
        print(f"{f['label']}, reported {f['start']}")
        print(f"  ten days before, then the day reported: {days}")
        print(f"  twelve hours before the report's hour, then three: {hours}")
    return 0


def spent(_: argparse.Namespace) -> int:
    ledger = bigquery.Ledger()
    for e in ledger.entries():
        print(f"{e['at']}  {e['label']:<28} {e['billed_bytes'] / 1e6:8.1f} MB  ${e['usd']:.5f}")
    print(f"total ${ledger.spent():.4f} of a ${settings.BUDGET_USD:.2f} budget")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("prepare").set_defaults(fn=prepare)
    s = sub.add_parser("snapshot")
    s.add_argument("--engine", choices=("offline", "bigquery"), default="offline")
    s.add_argument("--dry-run", action="store_true", help="estimate each BigQuery job and run none")
    s.add_argument("--steps", help=f"comma-separated, from {','.join(bigquery.STEPS)}")
    s.add_argument("--budget", type=float, default=settings.BUDGET_USD)
    s.set_defaults(fn=snap)
    sub.add_parser("spent").set_defaults(fn=spent)
    sub.add_parser("recount").set_defaults(fn=recount)
    sub.add_parser("early").set_defaults(fn=early)
    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
