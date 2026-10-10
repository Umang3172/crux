"""Command line: the fastest way to see the whole loop work.

uv run hypengine demo --fault outer_race
uv run hypengine evaluate --quick
uv run hypengine gemini-check
uv run hypengine benchmark
uv run hypengine frequencies --rpm 1798
uv run hypengine serve
"""

from __future__ import annotations

import json
import subprocess
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from .agents.factory import describe as describe_models
from .data import cwru
from .data.rig import BENCH_RIG, rig_oracle, scenario, synthetic_capture
from .data.root import DATA_ROOT
from .investigation.catalog import BY_ID
from .investigation.engine import Investigation
from .investigation.repair import check_repair
from .models import FaultKind, Observation
from .physics.frequencies import bearing_multipliers, fault_frequencies

app = typer.Typer(add_completion=False, help="Crux — MechNova")
console = Console()


def _pct(p: float, decimals: int = 0) -> str:
    """A belief as a percentage, never rounded up to certainty."""
    if p >= 1.0 - 0.5 * 10 ** -(decimals + 2):
        return f">{100 - 10**-decimals:.{decimals}f}%"
    return f"{p:.{decimals}%}"


@app.command()
def demo(
    fault: str = typer.Option(
        "outer_race",
        help="Fault to induce on the synthetic rig: a catalogue fault, or rolling_element or "
        "unlisted_impact, which the catalogue does not list",
    ),
    rpm: float = typer.Option(1798.0),
    severity: float = typer.Option(1.0),
    noise: float = typer.Option(
        0.05,
        help="Added sensor noise. With a moderate fault under heavy noise (e.g. --fault "
        "inner_race --severity 0.5 --noise 0.45) the physics cannot settle the case alone and "
        "asks for a measurement; a fainter one (--severity 0.35) ends unresolved.",
    ),
    verify: bool = typer.Option(
        True, help="Also capture the rig with the fault removed and check the repair"
    ),
) -> None:
    """Run one full investigation and print the transcript and ledger."""
    try:
        kind = scenario(fault)
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from exc
    console.print(
        Panel.fit(
            f"[bold]{BENCH_RIG.name}[/bold]  ·  {rpm:.0f} rpm\n"
            f"models: {describe_models()}\n"
            f"[dim]ground truth (hidden from the agent): {kind}[/dim]",
            title="Crux",
        )
    )

    obs = synthetic_capture(kind, BENCH_RIG, rpm=rpm, severity=severity, extra_noise=noise)
    inv = Investigation(BENCH_RIG, obs)
    state = inv.run(
        oracle=rig_oracle(kind, BENCH_RIG, severity=severity, extra_noise=noise, rpm=rpm)
    )

    console.print("\n[bold]Transcript[/bold]")
    for line in state.transcript:
        console.print(f"  • {line}")

    table = Table(title="\nBeliefs", show_lines=False)
    table.add_column("hypothesis")
    table.add_column("posterior", justify="right")
    table.add_column("correlation", justify="right")
    table.add_column("status")
    for h in sorted(state.hypotheses, key=lambda h: h.posterior, reverse=True):
        table.add_row(
            h.label,
            _pct(h.posterior, 1),
            "—" if h.correlation is None else f"{h.correlation:.2f}",
            "rejected" if h.rejected else "live",
        )
    console.print(table)

    console.print("\n[bold]Evidence ledger[/bold]")
    for e in state.ledger:
        console.print(f"  {e.render()}")

    c = state.conclusion
    if c:
        console.print(
            Panel.fit(
                f"[bold]{c.cause}[/bold] at {_pct(c.confidence)}\n\n"
                f"{c.reasoning}\n\n"
                f"[bold]Action[/bold]: {c.recommended_action}\n"
                f"[bold]What would change my mind[/bold]: {c.what_would_change_my_mind}",
                title="Conclusion",
            )
        )
        correct = c.root_cause == kind
        console.print(
            f"\n[{'green' if correct else 'red'}]"
            f"{'correct' if correct else 'WRONG'}[/] against the induced fault ({kind})"
        )
    elif state.outcome == "unresolved":
        console.print(Panel.fit(state.unresolved_reason or "", title="Unresolved"))
        console.print(
            f"\n[yellow]no verdict[/yellow] rather than a guess (the induced fault was {kind})"
        )

    if verify and c and c.root_cause is not FaultKind.HEALTHY:
        # The rig after a good repair: the same machine, same noise, no fault.
        after = synthetic_capture(
            FaultKind.HEALTHY, BENCH_RIG, rpm=rpm, seed=4242, extra_noise=noise
        )
        check = check_repair(inv, after)
        lines = "\n".join(
            f"  {change.line}: {change.before:g}x its floor before, {change.after:g}x after"
            for change in check.lines
        )
        console.print(
            Panel.fit(
                f"[bold]{check.outcome.replace('_', ' ')}[/bold]\n\n{check.statement}"
                + (f"\n{check.limit}" if check.limit else "")
                + (f"\n\n{lines}" if lines else ""),
                title="After the repair (the rig with the fault removed)",
            )
        )


@app.command()
def investigate(
    fault: str = typer.Option(
        "outer_race",
        help="Fault to induce on the synthetic rig: a catalogue fault, or rolling_element or "
        "unlisted_impact, which the catalogue does not list",
    ),
    severity: float = typer.Option(1.0),
    noise: float = typer.Option(0.05, help="Added sensor noise; see `demo --help`"),
    rounds: int = typer.Option(6, help="Investigator turns before the loop stops itself"),
) -> None:
    """Let the investigator agent run a case through the tools.

    Gemini when credentials are configured (Google Cloud login or an API key),
    the scripted offline investigator otherwise. The first line says which.
    """
    from .agents.investigator import investigate as run_agent
    from .tools import InMemoryCaseStore, open_case

    try:
        kind = scenario(fault)
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from exc
    store = InMemoryCaseStore()
    obs = synthetic_capture(kind, BENCH_RIG, severity=severity, extra_noise=noise)
    case = open_case(
        store,
        BENCH_RIG,
        obs,
        answer_source=rig_oracle(kind, BENCH_RIG, severity=severity, extra_noise=noise),
    )
    try:
        run = run_agent(store, case.id, max_rounds=rounds)
    except ImportError as exc:  # the agent framework is the optional `llm` extra
        console.print(
            f"[red]The investigator needs the agent framework ({exc}).[/red]\n"
            "Install it with:  uv sync --extra dev --extra llm"
        )
        raise typer.Exit(1) from exc
    view = run.case

    console.print(
        Panel.fit(
            f"[bold]model[/bold]: {run.model}\n[bold]rounds[/bold]: {run.rounds}\n"
            + (f"[bold]stopped[/bold]: {run.stopped}\n" if run.stopped else "")
            + f"[dim]ground truth (hidden from the agent): {kind}[/dim]",
            title="Investigator",
        )
    )
    console.print("\n[bold]Tool calls[/bold]")
    for name, args in run.tool_calls:
        shown = {k: v for k, v in args.items() if k != "case_id"}
        console.print(f"  • {name}({', '.join(f'{k}={v!r}' for k, v in shown.items())})")
    if run.thoughts:
        console.print("\n[bold]Reasoning the model showed[/bold]")
        for thought in run.thoughts:
            console.print(f"  • {thought}")
    console.print("\n[bold]Narration[/bold]")
    for line in view.narration:
        console.print(f"  • {line}")
    if view.status == "concluded":
        console.print(Panel.fit(f"{view.leader} at {_pct(view.leader_belief)}", title="Concluded"))
    elif view.status == "unresolved":
        console.print(Panel.fit(view.unresolved_reason or "", title="Unresolved"))
    else:
        waiting = [r.test_name for r in view.requests if r.status == "waiting"]
        console.print(
            Panel.fit(f"open; waiting for: {', '.join(waiting) or 'nothing'}", title="Open")
        )


@dataclass(frozen=True)
class _CaseResult:
    """What one real recording cost and what we concluded from it."""

    case: cwru.CwruCase
    predicted: FaultKind | None  # None when the case closed unresolved
    confidence: float
    answered: tuple[str, ...]  # tests the recording could answer
    unanswerable: tuple[str, ...]  # tests only a person at the machine can answer
    reason: str = ""
    #: What the case was scored against: the machine's own healthy recording at
    #: the same load, or the textbook machine.
    scored: str = "textbook"
    note: str = ""

    @property
    def minutes(self) -> float:
        return sum(BY_ID[t].effort_min for t in self.answered)

    @property
    def concluded(self) -> bool:
        return self.predicted is not None

    @property
    def correct(self) -> bool:
        return self.predicted is self.case.kind


#: Share of a healthy recording kept as that machine's normal, and the number of
#: captures it is cut into. The rest of the recording is the healthy case itself,
#: so nothing is both a case and its own normal. Four captures show how far the
#: normal wanders, and most of the recording is left for the case. Design
#: choices (docs/DATA.md).
NORMAL_SHARE = 0.4
NORMAL_CAPTURES = 4


def _own_normal(healthy: cwru.CwruCase) -> tuple[list[Observation], float]:
    """The start of a healthy recording as the machine's normal at that load, and
    the second at which the rest of the recording begins."""
    kept = NORMAL_SHARE * cwru.seconds_in(healthy.file)
    each = kept / NORMAL_CAPTURES
    captures = [
        cwru.load_capture(healthy.file, duration_s=each, offset_s=k * each)
        for k in range(NORMAL_CAPTURES)
    ]
    return captures, kept


def _run_cwru_case(
    case: cwru.CwruCase,
    max_requests: int,
    seconds: float,
    normal: list[Observation] | None = None,
    offset_s: float = 0.0,
    note: str = "",
) -> _CaseResult:
    """One full investigation against a real capture.

    There is no oracle here. The case is opened on `seconds` of the recording,
    from `offset_s`, and a requested capture is answered by the stretch that
    follows, scored at its own length: the same machine in the same state, with
    noise the first look has not seen. A test the recording cannot answer — a
    coast-down, a temperature reading, or a capture when no second stretch of
    that length is left — comes back as nothing rather than as a fabricated
    number. Faking those would make the headline number meaningless.

    With `normal`, healthy captures of the same machine at the same load, the
    case is scored on the change from them; without, against the textbook machine.
    """
    observation = cwru.load_capture(case.file, duration_s=seconds, offset_s=offset_s)
    investigation = Investigation(cwru.CWRU_DRIVE_END, observation, normal=normal or ())
    answered: list[str] = []
    unanswerable: list[str] = []

    def measure(test_id: str) -> Observation | None:
        try:
            if BY_ID[test_id].capture_s is None:
                raise ValueError("only a person at the machine can report it")
            later = cwru.load_capture(case.file, duration_s=seconds, offset_s=offset_s + seconds)
            if len(later.waveform) < len(observation.waveform):
                raise ValueError("the recording has no second stretch of that length")
        except ValueError:
            unanswerable.append(test_id)
            return None
        answered.append(test_id)
        return later

    state = investigation.run(max_requests=max_requests, oracle=measure)
    conclusion = state.conclusion
    return _CaseResult(
        case=case,
        predicted=conclusion.root_cause if conclusion else None,
        confidence=conclusion.confidence if conclusion else state.leader().posterior,
        answered=tuple(answered),
        unanswerable=tuple(unanswerable),
        reason=state.unresolved_reason or "",
        scored="own normal" if normal else "textbook",
        note=note,
    )


def _summary(results: list[_CaseResult]) -> dict[str, float | int]:
    """The benchmark's counts, in the order they are reported."""
    n = len(results)
    concluded = [r for r in results if r.concluded]
    right = sum(r.correct for r in concluded)
    return {
        "cases": n,
        "settled_by_simulation": sum(1 for r in concluded if not r.answered and not r.unanswerable),
        "settled_after_measurement": sum(1 for r in concluded if r.answered),
        "unresolved": n - len(concluded),
        "asked_what_no_recording_answers": sum(1 for r in results if r.unanswerable),
        "mean_minutes": round(sum(r.minutes for r in results) / n, 2),
        "wrong": len(concluded) - right,
        "right": right,
    }


def _code_version() -> dict[str, str | bool] | None:
    """The commit a result was produced by, when the code is in a checkout."""
    here = Path(__file__).resolve().parent
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=here,
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        ).stdout.strip()
        changed = subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=no"],
            cwd=here,
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    return {"commit": commit, "uncommitted_changes": bool(changed)}


def _result_file(
    results: list[_CaseResult],
    skipped: list[str],
    *,
    textbook: bool,
    seconds: float,
    max_requests: int,
) -> dict:
    """Everything needed to quote a number from this run and say where it came from."""
    return {
        "benchmark": "CWRU drive end, 12 kHz",
        "data": "Case Western Reserve University Bearing Data Center",
        "scored_against": "the textbook machine"
        if textbook
        else "each machine's own healthy recording at the same load",
        "code": _code_version(),
        "run_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "settings": {
            "seconds": seconds,
            "max_requests": max_requests,
            "normal_share": NORMAL_SHARE,
            "normal_captures": NORMAL_CAPTURES,
        },
        "summary": _summary(results),
        "cases": [
            {
                "file": r.case.file.name,
                "truth": r.case.kind.value,
                "load_hp": r.case.load_hp,
                "diagnosed": r.predicted.value if r.predicted is not None else None,
                "belief": round(r.confidence, 4),
                "scored": r.scored,
                "asked": list(r.answered),
                "unanswerable": list(r.unanswerable),
                "minutes": r.minutes,
                "reason": r.reason,
                "note": r.note,
            }
            for r in results
        ],
        "skipped": skipped,
    }


def _confusion(results: list[_CaseResult]) -> Table:
    seen = {r.case.kind for r in results} | {r.predicted for r in results if r.concluded}
    columns: list[FaultKind | None] = [k for k in FaultKind if k in seen]
    if any(not r.concluded for r in results):
        columns.append(None)
    truths = [k for k in FaultKind if any(r.case.kind is k for r in results)]
    counts = Counter((r.case.kind, r.predicted) for r in results)

    table = Table(title="\nConfusion — rows are the true fault, columns the diagnosis")
    table.add_column("truth \\ diagnosed")
    for kind in columns:
        table.add_column(
            "unresolved" if kind is None else kind.value.replace("_", " "), justify="right"
        )
    for truth in truths:
        row = [truth.value.replace("_", " ")]
        for predicted in columns:
            n = counts[(truth, predicted)]
            if not n:
                row.append("[dim]·[/dim]")
            elif predicted is None:
                row.append(f"[yellow]{n}[/yellow]")
            else:
                row.append(f"[green]{n}[/green]" if truth is predicted else f"[red]{n}[/red]")
        table.add_row(*row)
    return table


@app.command()
def benchmark(
    data_dir: str = typer.Option(str(cwru.DATA_DIR), help="Folder of CWRU .mat files"),
    seconds: float = typer.Option(4.0, help="Seconds of each recording to use"),
    max_requests: int = typer.Option(2, help="Measurements the investigator may ask for"),
    per_case: bool = typer.Option(True, help="Print a row per recording as well as the summary"),
    textbook: bool = typer.Option(
        False,
        help="Score every case against the textbook machine, ignoring the healthy recordings. "
        "The default scores each case on the change from the healthy recording at its load.",
    ),
    out: str = typer.Option(
        "",
        help="Where to write the result file. Default: results/cwru-own-normal.json or "
        "results/cwru-textbook.json under the data folder. 'none' writes nothing.",
    ),
) -> None:
    """Run the investigator over real CWRU bearing recordings.

    Accuracy is the number a judge asks for first, and it is the least
    interesting one here: a classifier can win it. The three lines above it —
    cases settled by simulation alone, cases that needed a human measurement,
    and technician-minutes spent — are what this product is for.

    Each load's healthy recording is that machine's normal: its start is kept
    as the normal, the rest is the healthy case, and every fault recording at
    that load is scored on the change from it. `--textbook` gives the comparison.
    The run is written to a result file, with the commit that produced it.
    """
    files = cwru.available(data_dir)
    if not files:
        console.print(
            Panel.fit(
                f"No .mat files in [bold]{data_dir}[/bold].\n\n"
                "Fetch a subset (you run this, not the agent):\n"
                "  [bold]uv run python scripts/fetch_cwru.py[/bold]\n\n"
                "Or drop files from https://engineering.case.edu/bearingdatacenter\n"
                "in by hand. docs/DATA.md has the naming convention the loader expects.",
                title="No CWRU data",
            )
        )
        raise typer.Exit()

    cases: list[cwru.CwruCase] = []
    skipped: list[str] = []
    for path in files:
        try:
            cases.append(cwru.parse_filename(path))
        except ValueError as exc:
            skipped.append(str(exc))

    if not cases:
        console.print(f"[yellow]{len(files)} .mat files, none of them usable:[/yellow]")
        for why in skipped:
            console.print(f"  [dim]{why}[/dim]")
        raise typer.Exit()

    healthy_at = {c.load_hp: c for c in cases if c.kind is FaultKind.HEALTHY}
    results: list[_CaseResult] = []
    with console.status(f"Investigating {len(cases)} recordings…"):
        for case in cases:
            normal, start, note = None, 0.0, ""
            if not textbook:
                baseline = healthy_at.get(case.load_hp)
                if baseline is None:
                    note = "no healthy recording at this load: scored against the textbook"
                else:
                    normal, kept = _own_normal(baseline)
                    # A healthy recording is not judged against itself: its case
                    # is the part its normal did not use.
                    start = kept if case.kind is FaultKind.HEALTHY else 0.0
            results.append(_run_cwru_case(case, max_requests, seconds, normal, start, note))

    if per_case:
        table = Table(title=f"Real captures · first {seconds:.0f} s of each recording")
        table.add_column("file")
        table.add_column("truth")
        table.add_column("diagnosed")
        table.add_column("conf", justify="right")
        table.add_column("asked for")
        table.add_column("min", justify="right")
        table.add_column("scored against")
        for r in results:
            asked = list(r.answered)
            asked += [f"[yellow]{t} (unanswerable)[/yellow]" for t in r.unanswerable]
            if r.concluded:
                verdict = f"[{'green' if r.correct else 'red'}]{r.predicted.value}[/]"
            else:
                verdict = "[yellow]unresolved[/yellow]"
            table.add_row(
                r.case.file.name,
                r.case.label,
                verdict,
                f"{r.confidence:.0%}",
                ", ".join(asked) or "[dim]nothing[/dim]",
                f"{r.minutes:.0f}",
                r.scored if not r.note else f"[yellow]{r.scored}[/yellow]",
            )
        console.print(table)

    console.print(_confusion(results))

    counts = _summary(results)
    n = int(counts["cases"])
    concluded = [r for r in results if r.concluded]
    correct, wrong = int(counts["right"]), int(counts["wrong"])
    sim_only = int(counts["settled_by_simulation"])
    measured = int(counts["settled_after_measurement"])
    unresolved = int(counts["unresolved"])
    blocked = int(counts["asked_what_no_recording_answers"])
    mean_minutes = float(counts["mean_minutes"])

    def row(label: str, value: str, share: str = "") -> str:
        return f"{label:<42}[bold]{value:>7}[/bold]  {share}"

    accuracy = (
        row(
            "accuracy of the verdicts given",
            f"{correct} / {len(concluded)}",
            f"{correct / len(concluded):.0%}",
        )
        if concluded
        else row("accuracy of the verdicts given", "none given")
    )
    console.print(
        Panel.fit(
            "\n".join(
                [
                    "Scored against "
                    + ("the textbook machine." if textbook else "each machine's own normal."),
                    "",
                    row("settled by simulation alone", f"{sim_only} / {n}", f"{sim_only / n:.0%}"),
                    row(
                        "settled after a requested measurement",
                        f"{measured} / {n}",
                        f"{measured / n:.0%}",
                    ),
                    row(
                        "said it could not tell (unresolved)",
                        f"{unresolved} / {n}",
                        f"{unresolved / n:.0%}",
                    ),
                    row("requested a test no recording can answer", f"{blocked} / {n}"),
                    row("mean technician-minutes per case", f"{mean_minutes:.1f}"),
                    "",
                    row("wrong verdicts", f"{wrong} / {n}", f"{wrong / n:.0%}"),
                    accuracy,
                    "",
                    "[dim]Minutes avoided and wrong verdicts are the headline. A classifier",
                    "answers every case and spends the same technician time on each; this",
                    "answers when the evidence reaches the bar and says so when it does not.",
                    "See docs/DATA.md.[/dim]",
                ]
            ),
            title="Benchmark · CWRU drive end, 12 kHz",
        )
    )

    for why in skipped:
        console.print(f"[dim]skipped {why}[/dim]")
    for r in results:
        if r.note:
            console.print(f"[yellow]{r.case.file.name}: {r.note}[/yellow]")

    if out.lower() != "none":
        name = "cwru-textbook.json" if textbook else "cwru-own-normal.json"
        path = Path(out) if out else DATA_ROOT / "results" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        record = _result_file(
            results, skipped, textbook=textbook, seconds=seconds, max_requests=max_requests
        )
        path.write_text(json.dumps(record, indent=2) + "\n")
        console.print(f"[dim]Result written to {path}[/dim]")


#: The hard synthetic cases `evaluate` runs: faults at three strengths under four
#: levels of sensor noise, where the first capture alone often cannot decide.
EVALUATE_FAULTS = (FaultKind.OUTER_RACE, FaultKind.INNER_RACE, FaultKind.IMBALANCE)
EVALUATE_SEVERITIES = (0.35, 0.5, 0.75)
EVALUATE_NOISE = (0.25, 0.35, 0.45, 0.6)
EVALUATE_SEEDS = (11, 12, 13, 555, 1234)


@dataclass(frozen=True)
class Scored:
    """One synthetic case: what was fed in, what Crux said, and what the best
    spectral match alone would have said."""

    truth: FaultKind
    verdict: str | None  # None: Crux ended the case unresolved
    best_match: str
    asked: int

    @property
    def outcome(self) -> str:
        if self.verdict is None:
            return "unresolved"
        return "right" if self.verdict == self.truth.value else "wrong"


def score_synthetic(fault: FaultKind, severity: float, noise: float, seed: int) -> Scored:
    """Run one case end to end, answered honestly by the rig, and read off what
    a similarity classifier would have said from the same first capture.

    The classifier is the simplest thing that always answers: simulate each
    suspect once and name the one whose spectrum correlates best with the
    capture. Crux draws that same comparison as a picture and does not decide by it.
    """
    obs = synthetic_capture(fault, BENCH_RIG, severity=severity, extra_noise=noise, seed=seed)
    inv = Investigation(BENCH_RIG, obs)
    state = inv.run(oracle=rig_oracle(fault, BENCH_RIG, severity=severity, extra_noise=noise))
    best = max(state.hypotheses, key=lambda h: h.correlation or 0.0)
    verdict = state.conclusion.cause if state.conclusion is not None else None
    return Scored(fault, verdict, best.name, len(state.outcomes))


@app.command()
def evaluate(
    quick: bool = typer.Option(False, help="18 cases in about half a minute, not all 180."),
) -> None:
    """How often is Crux wrong? Hard synthetic cases, answered honestly.

    Each case is a fault at part strength under sensor noise. Crux gets one
    capture, may ask for up to two measurements (answered by a new capture of
    the same machine in the same state), and then names a cause or says it
    cannot. Beside it: what the best spectral match alone would have named.

    Synthetic: the captures and the simulations share one signal model, so this
    measures the decision rule, not the model's fit to a real machine.
    """
    severities = (0.5,) if quick else EVALUATE_SEVERITIES
    noises = (0.25, 0.45) if quick else EVALUATE_NOISE
    seeds = EVALUATE_SEEDS[:3] if quick else EVALUATE_SEEDS
    results: list[Scored] = []
    with console.status("") as status:
        for fault in EVALUATE_FAULTS:
            for severity in severities:
                for noise in noises:
                    for seed in seeds:
                        status.update(
                            f"{len(results) + 1}: {fault.value}, strength {severity}, noise {noise}"
                        )
                        results.append(score_synthetic(fault, severity, noise, seed))

    table = Table(title=f"\n{len(results)} synthetic cases — what Crux said, by true fault")
    for name in ("true fault", "right", "unresolved", "wrong", "asked a check", "best match right"):
        table.add_column(name, justify="left" if name == "true fault" else "right")
    for fault in (*EVALUATE_FAULTS, None):
        rows = [r for r in results if fault is None or r.truth is fault]
        tally = Counter(r.outcome for r in rows)
        matched = sum(r.best_match == r.truth.value for r in rows)
        wrong = tally["wrong"]
        table.add_row(
            "all" if fault is None else fault.value.replace("_", " "),
            f"[green]{tally['right']}[/green]",
            f"[yellow]{tally['unresolved']}[/yellow]",
            f"[red]{wrong}[/red]" if wrong else "0",
            str(sum(r.asked > 0 for r in rows)),
            f"{matched} of {len(rows)}",
            end_section=fault is EVALUATE_FAULTS[-1],
        )
    console.print(table)
    matched = sum(r.best_match == r.truth.value for r in results)
    console.print(
        f"The best spectral match alone names the true fault in {matched} of {len(results)} "
        f"and a wrong one in {len(results) - matched}: it always answers. Crux names a cause "
        "only at 80% belief with nothing left unexplained, and otherwise says it cannot."
    )
    console.print(
        "[dim]Synthetic captures from the engine's own signal model: this measures the "
        "decision rule, not how well the model fits a real machine (docs/DATA.md).[/dim]"
    )


@app.command("gemini-check")
def gemini_check(
    only: str = typer.Option("", help="Check only these call sites: names separated by commas."),
) -> None:
    """Try every place Crux calls Gemini, once, and say which ones work.

    Each call site does one small piece of its own job with the model it would
    really use. With no credentials nothing is called and the output says what
    to set. Exits 1 if a call site that is switched on failed.
    """
    from .agents import factory, preflight

    route = factory.gemini_route()
    console.print(f"Gemini is reached by: [bold]{route or 'nothing, it is off'}[/bold]")
    if route is None:
        console.print(f"To turn it on: {preflight.HOW_TO_TURN_ON}.", soft_wrap=True)
    with console.status("asking each call site to do its job once"):
        results = preflight.run(tuple(name.strip() for name in only.split(",") if name.strip()))
    colour = {"ok": "green", "failed": "red", "off": "yellow", "skipped": "yellow"}
    table = Table(title="\nEvery place a Gemini model is called")
    for name in ("call site", "model", "result", "seconds", "what happened"):
        table.add_column(name, justify="right" if name == "seconds" else "left")
    for r in results:
        table.add_row(
            r.role.replace("_", " "),
            r.model,
            f"[{colour[r.status]}]{r.status}[/{colour[r.status]}]",
            f"{r.seconds:.1f}" if r.seconds else "",
            r.detail,
        )
    console.print(table)
    if any(r.status == "failed" for r in results):
        raise typer.Exit(1)


@app.command()
def frequencies(rpm: float = typer.Option(1798.0)) -> None:
    """Print the fault frequencies for the rig bearing at a given speed."""
    mult = bearing_multipliers(BENCH_RIG.bearing)
    ff = fault_frequencies(BENCH_RIG.bearing, rpm)
    table = Table(title=f"{BENCH_RIG.bearing.label} at {rpm:.0f} rpm")
    table.add_column("component")
    table.add_column("x shaft", justify="right")
    table.add_column("Hz", justify="right")
    table.add_row("shaft (1x)", "1.0000", f"{ff.shaft:.2f}")
    for key, value in mult.items():
        table.add_row(key.upper(), f"{value:.4f}", f"{value * ff.shaft:.2f}")
    table.add_row("2x BSF", f"{2 * mult['bsf']:.4f}", f"{ff.bsf_2x:.2f}")
    console.print(table)


@app.command()
def serve(host: str = "0.0.0.0", port: int = 8080, reload: bool = False) -> None:
    """Run the API (this is what Cloud Run starts)."""
    import uvicorn

    uvicorn.run("hypothesis_engine.api.app:app", host=host, port=port, reload=reload)


if __name__ == "__main__":
    app()
