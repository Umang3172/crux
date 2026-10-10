"""Command line: the fastest way to see the whole loop work.

uv run hypengine demo --fault outer_race
uv run hypengine benchmark
uv run hypengine frequencies --rpm 1798
uv run hypengine serve
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from .agents.factory import describe as describe_models
from .data import cwru
from .data.rig import BENCH_RIG, rig_oracle, scenario, synthetic_capture
from .investigation.catalog import BY_ID
from .investigation.engine import Investigation, verify_repair
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
    verify: bool = typer.Option(True, help="Also show post-repair verification"),
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

    if verify and c and c.root_cause is not None:
        after = synthetic_capture(FaultKind.HEALTHY, BENCH_RIG, rpm=rpm, seed=4242)
        result = verify_repair(obs, after, BENCH_RIG, c.root_cause)
        console.print(
            Panel.fit(
                "\n".join(f"{k}: {v}" for k, v in result.items()),
                title="Repair verification",
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

    @property
    def minutes(self) -> float:
        return sum(BY_ID[t].effort_min for t in self.answered)

    @property
    def concluded(self) -> bool:
        return self.predicted is not None

    @property
    def correct(self) -> bool:
        return self.predicted is self.case.kind


def _run_cwru_case(case: cwru.CwruCase, max_requests: int, seconds: float) -> _CaseResult:
    """One full investigation against a real capture.

    There is no oracle here. The case is opened on the first `seconds` of the
    recording, and a requested capture is answered by the stretch that follows,
    scored at its own length: the same machine in the same state, with noise the
    first look has not seen. A test the recording cannot answer — a coast-down,
    a temperature reading, or a capture when no second stretch of that length
    is left — comes back as nothing rather than as a fabricated number. Faking
    those would make the headline number meaningless.
    """
    observation = cwru.load_capture(case.file, duration_s=seconds)
    investigation = Investigation(cwru.CWRU_DRIVE_END, observation)
    answered: list[str] = []
    unanswerable: list[str] = []

    def measure(test_id: str) -> Observation | None:
        try:
            if BY_ID[test_id].capture_s is None:
                raise ValueError("only a person at the machine can report it")
            later = cwru.load_capture(case.file, duration_s=seconds, offset_s=seconds)
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
    )


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
) -> None:
    """Run the investigator over real CWRU bearing recordings.

    Accuracy is the number a judge asks for first, and it is the least
    interesting one here: a classifier can win it. The three lines above it —
    cases settled by simulation alone, cases that needed a human measurement,
    and technician-minutes spent — are what this product is for.
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

    results: list[_CaseResult] = []
    with console.status(f"Investigating {len(cases)} recordings…"):
        for case in cases:
            results.append(_run_cwru_case(case, max_requests, seconds))

    if per_case:
        table = Table(title=f"Real captures · first {seconds:.0f} s of each recording")
        table.add_column("file")
        table.add_column("truth")
        table.add_column("diagnosed")
        table.add_column("conf", justify="right")
        table.add_column("asked for")
        table.add_column("min", justify="right")
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
            )
        console.print(table)

    console.print(_confusion(results))

    n = len(results)
    concluded = [r for r in results if r.concluded]
    correct = sum(r.correct for r in concluded)
    wrong = len(concluded) - correct
    sim_only = sum(1 for r in concluded if not r.answered and not r.unanswerable)
    measured = sum(1 for r in concluded if r.answered)
    unresolved = n - len(concluded)
    blocked = sum(1 for r in results if r.unanswerable)
    mean_minutes = sum(r.minutes for r in results) / n

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
