"""Command line: the fastest way to see the whole loop work.

uv run hypengine demo --fault outer_race
uv run hypengine frequencies --rpm 1798
uv run hypengine serve
"""

from __future__ import annotations

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from .agents.factory import describe as describe_models
from .data.rig import BENCH_RIG, rig_oracle, synthetic_capture
from .investigation.engine import Investigation, verify_repair
from .models import FaultKind
from .physics.frequencies import bearing_multipliers, fault_frequencies

app = typer.Typer(add_completion=False, help="Hypothesis Engine — MechNova")
console = Console()


@app.command()
def demo(
    fault: str = typer.Option("outer_race", help="Fault to induce on the synthetic rig"),
    rpm: float = typer.Option(1798.0),
    severity: float = typer.Option(1.0),
    verify: bool = typer.Option(True, help="Also show post-repair verification"),
) -> None:
    """Run one full investigation and print the transcript and ledger."""
    kind = FaultKind(fault)
    console.print(
        Panel.fit(
            f"[bold]{BENCH_RIG.name}[/bold]  ·  {rpm:.0f} rpm\n"
            f"models: {describe_models()}\n"
            f"[dim]ground truth (hidden from the agent): {kind.value}[/dim]",
            title="Hypothesis Engine",
        )
    )

    obs = synthetic_capture(kind, BENCH_RIG, rpm=rpm, severity=severity)
    inv = Investigation(BENCH_RIG, obs)
    state = inv.run(oracle=rig_oracle(kind, BENCH_RIG))

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
            f"{h.posterior:.1%}",
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
                f"[bold]{c.root_cause.value}[/bold] at {c.confidence:.0%}\n\n"
                f"{c.reasoning}\n\n"
                f"[bold]Action[/bold]: {c.recommended_action}\n"
                f"[bold]What would change my mind[/bold]: {c.what_would_change_my_mind}",
                title="Conclusion",
            )
        )
        correct = c.root_cause == kind
        console.print(
            f"\n[{'green' if correct else 'red'}]"
            f"{'correct' if correct else 'WRONG'}[/] against the induced fault ({kind.value})"
        )

    if verify and c:
        after = synthetic_capture(FaultKind.HEALTHY, BENCH_RIG, rpm=rpm, seed=4242)
        result = verify_repair(obs, after, BENCH_RIG, c.root_cause)
        console.print(
            Panel.fit(
                "\n".join(f"{k}: {v}" for k, v in result.items()),
                title="Repair verification",
            )
        )


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
