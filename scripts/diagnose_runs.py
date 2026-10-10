#!/usr/bin/env python3
"""Run the investigation on real failing bearings, at the moment the watcher fired.

    uv run python scripts/diagnose_runs.py                 # XJTU-SY, every bearing with an alarm
    uv run python scripts/diagnose_runs.py --no-answers    # Crux's first read only
    uv run python scripts/diagnose_runs.py --textbook      # without the bearing's own normal

For each XJTU-SY bearing the snapshot at the watcher's alarm is the reading,
and the bearing's own early minutes are its normal (`investigation.recorded`);
`--textbook` leaves them out, so the two can be compared. When Crux asks for a
check, it is answered from the bearing's next recorded minute, handed over as a
capture. The dataset's answer key is used only to score the result, never as
input.

A cage fault and the bearings with several damaged parts are not in the
catalogue: the right answer there is "unresolved". Needs the XJTU-SY files and
`scripts/forecast.py table --dataset xjtu`. Writes data/forecast/diagnosis_xjtu.md.
"""

from __future__ import annotations

import argparse
import sys

from hypothesis_engine.data import xjtu
from hypothesis_engine.forecast import health, runs
from hypothesis_engine.forecast.models import onset_of
from hypothesis_engine.investigation.recorded import NORMAL_SNAPSHOTS, investigate_recording

TABLE = runs.DATA_ROOT / "forecast" / "health_xjtu.csv"
OUT = runs.DATA_ROOT / "forecast" / "diagnosis_xjtu.md"

#: The answer key in the catalogue's terms. Anything else has no hypothesis.
IN_CATALOGUE = {"outer race": "outer_race", "inner race": "inner_race"}


def grade(truth: str, verdict: str) -> str:
    expected = IN_CATALOGUE.get(truth)
    if verdict == "unresolved":
        return "right to say it cannot tell" if expected is None else "unresolved"
    if expected is None:
        return "confidently wrong (not in the catalogue)"
    return "right" if verdict == expected else "confidently wrong"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--no-answers", action="store_true", help="do not answer Crux's requested checks"
    )
    ap.add_argument("--max-requests", type=int, default=2)
    ap.add_argument(
        "--textbook",
        action="store_true",
        help="score against the textbook machine, not the bearing's own early minutes",
    )
    args = ap.parse_args(argv)
    if not TABLE.exists():
        print(
            "no XJTU-SY health table: run scripts/forecast.py table --dataset xjtu", file=sys.stderr
        )
        return 1
    tables = {h.run_id: h for h in (health.trim_stopped(x) for x in health.load(TABLE))}
    lines = [
        "Crux's investigation on XJTU-SY bearings at the watcher's alarm"
        + (" (first read only)" if args.no_answers else " (checks answered from the next minute)")
        + (
            ", scored against a textbook machine"
            if args.textbook
            else ", scored against each bearing's own early minutes"
        ),
        "",
        "| bearing | failed part (answer key) | Crux's verdict | leader and belief | checks asked | grade |",
        "|---|---|---|---|---|---|",
    ]
    tally: dict[str, int] = {}
    for run in runs.xjtu_runs():
        h = tables.get(run.run_id)
        o = onset_of(h) if h is not None else None
        if o is None:
            lines.append(f"| {run.run_id} | {run.failure_mode} | no alarm | - | - | - |")
            continue
        start = int(round(h.t[o]))  # XJTU-SY: minute n is file n + 1
        st = investigate_recording(
            xjtu.machine(run),
            lambda i, run=run: xjtu.observation(run, i),
            start,
            start + 1 if args.no_answers else len(run),
            max_requests=args.max_requests,
            normal=() if args.textbook else NORMAL_SNAPSHOTS,
        )
        lead = st.leader()
        # The engine names a cause only at its bar; anything else is "unresolved".
        c = st.conclusion
        verdict = c.cause if c is not None else "unresolved"
        g = grade(run.failure_mode, verdict)
        tally[g] = tally.get(g, 0) + 1
        lines.append(
            f"| {run.run_id} | {run.failure_mode} | {verdict} | {lead.name} {lead.posterior:.2f} "
            f"| {', '.join(st.requested_tests) or 'none'} | {g} |"
        )
    lines += ["", "Totals: " + "; ".join(f"{k}: {v}" for k, v in sorted(tally.items()))]
    text = "\n".join(lines)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text + "\n")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
