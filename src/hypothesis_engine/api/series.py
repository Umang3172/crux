"""Trends endpoints: forecasts and analyses of sensor history, by Google's tools.

Read-only, served from snapshots (`series/snapshot.py`): a page view never
calls Google, so the public link spends nothing. The one exception is
`POST /series/ask` (and `/series/ask/live`, the same question answered as a
stream of its steps), which exists only when `CRUX_SERIES_ASK` is set and is
capped per query and per hour (`series/ask.py`). Nothing here reads or moves an
investigation.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..series import ask as ask_data
from ..series import bench as bench_board
from ..series import snapshot

router = APIRouter(prefix="/series", tags=["time series"])


class Made(BaseModel):
    """How a view was made: engine "bigquery" or "offline stand-in", and the exact SQL."""

    engine: str
    model: str
    product: str
    sql: str = ""
    settings: dict[str, Any] = Field(default_factory=dict)
    computed_at: str
    cost: dict[str, Any] = Field(default_factory=dict)


class Line(BaseModel):
    t: list[int]  # seconds since 1970, the dataset's own clock read as UTC
    v: list[float | None]  # null where nothing was recorded


class Band(BaseModel):
    t: list[int]
    p50: list[float | None]
    lo: list[float | None]
    hi: list[float | None]


class Window(BaseModel):
    start: int
    end: int
    label: str = ""


class ForecastSignal(BaseModel):
    id: str
    name: str
    unit: str
    history: Line
    actual: Line  # what really happened after "as of": a replay, never shown to the model
    forecast: Band


class ForecastView(BaseModel):
    source: str
    preset: str
    view: str
    span: str
    as_of: int
    cadence_min: int
    horizon: int
    signals: list[ForecastSignal]
    failures: list[Window]
    made: Made


class AnomalySignal(BaseModel):
    id: str
    name: str
    unit: str
    t: list[int]
    v: list[float | None]
    lo: list[float | None]
    hi: list[float | None]
    flagged: list[int]  # indexes into t
    prob: list[float | None] | None
    # the flagged readings that count: for the compressor, only while the motor ran
    counted: list[int] = []
    counted_before: int | None = None
    counted_after: int | None = None


class Tally(BaseModel):
    preset: str
    label: str
    before: int
    after: int | None
    signals: dict[str, dict[str, int | None]]


class AnomaliesView(BaseModel):
    source: str
    preset: str
    view: str
    as_of: int | None
    relative: bool  # true: t is a run's own clock, draw it as hours from `origin`
    origin: int | None = None
    cadence_min: int
    window: Window
    flagged: int
    flagged_after_as_of: int | None
    counted: int | None = None
    counted_after_as_of: int | None = None
    not_counted_off: int = 0
    off: list[int] = []  # steps where the motor was off most of the time
    normal: Tally | None = None  # the normal week's counts, for a leak week
    signals: list[AnomalySignal]
    failures: list[Window]
    made: Made


class Step(BaseModel):
    t: int
    size: float | None


class BreakdownSignal(BaseModel):
    id: str
    name: str
    unit: str
    t: list[int]
    observed: list[float | None]
    parts: dict[str, list[float | None]]
    step_list: list[Step]
    forecast: Band
    model: dict[str, Any]


class BreakdownView(BaseModel):
    source: str
    preset: str
    view: str
    as_of: int
    cadence_min: int
    signals: list[BreakdownSignal]
    failures: list[Window]
    made: Made


class ChangeRow(BaseModel):
    contributors: list[str]
    label: str
    test: float | None
    control: float | None
    ratio: float | None
    attribution: float | None
    support: float | None


class ChangesView(BaseModel):
    source: str
    preset: str
    view: str
    metric: str
    test: Window
    control: Window
    overall: dict[str, float | None]
    rows: list[ChangeRow]
    made: Made


class SummaryView(BaseModel):
    source: str
    preset: str
    view: str
    text: str
    sentences: list[str]
    facts: list[str]
    writer: str
    made: Made


class Question(BaseModel):
    question: str = Field(min_length=3, max_length=500)


class Answer(BaseModel):
    question: str
    answer: str
    steps: list[str]
    sql: str
    columns: list[str]
    rows: list[list[Any]]
    chart: dict[str, Any] | None
    followups: list[str]
    made: dict[str, Any]


class Examples(BaseModel):
    live: bool
    answers: list[Answer]


def _view(source: str, preset: str, view: str) -> dict[str, Any]:
    try:
        return snapshot.load(source, preset, view)
    except snapshot.NotAvailable as exc:
        raise HTTPException(404, str(exc)) from None


@router.get("/catalog")
def catalog() -> dict[str, Any]:
    """Sources, their signals and "as of" moments, spans, and which engine serves each view."""
    return snapshot.catalog()


@router.get("/{source}/forecast", response_model=ForecastView)
def forecast(source: str, preset: str, span: str = "day") -> dict[str, Any]:
    return _view(source, preset, f"forecast-{span}")


@router.get("/{source}/anomalies", response_model=AnomaliesView)
def anomalies(source: str, preset: str) -> dict[str, Any]:
    return _view(source, preset, "anomalies")


@router.get("/{source}/breakdown", response_model=BreakdownView)
def breakdown(source: str, preset: str) -> dict[str, Any]:
    return _view(source, preset, "breakdown")


@router.get("/{source}/changes", response_model=ChangesView)
def changes(source: str, preset: str) -> dict[str, Any]:
    return _view(source, preset, "changes")


@router.get("/{source}/summary", response_model=SummaryView)
def summary(source: str, preset: str) -> dict[str, Any]:
    return _view(source, preset, "summary")


@router.get("/{source}/bench")
def bench(source: str) -> dict[str, Any]:
    """Every day of the record scored: the next-day forecasts and the leak detectors."""
    if source != "metro":
        raise HTTPException(404, f"no benchmark for {source}")
    try:
        return bench_board.load()
    except FileNotFoundError as exc:
        raise HTTPException(404, f"no recorded history on this server: {exc}") from None


@router.get("/ask/examples", response_model=Examples)
def ask_examples() -> dict[str, Any]:
    """Questions answered once by Google's data agent, saved, plus whether live questions are on."""
    return {"live": ask_data.enabled(), "answers": snapshot.examples()}


@router.post("/ask", response_model=Answer)
def ask(q: Question) -> dict[str, Any]:
    """A live question to Google's data agent. Only when CRUX_SERIES_ASK is set."""
    if not ask_data.enabled():
        raise HTTPException(404, "live questions are off on this server")
    from ..series.bigquery import Ledger

    try:
        return ask_data.ask(q.question, ledger=Ledger())
    except ask_data.AskLimited as exc:
        raise HTTPException(429, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    except Exception as exc:  # noqa: BLE001 - Google's error goes back as a plain message
        raise HTTPException(
            502, f"the data agent did not answer: {type(exc).__name__}: {exc}"[:300]
        ) from None


@router.post("/ask/live")
async def ask_live(q: Question) -> StreamingResponse:
    """The same live question, answered as it runs: one JSON line per step, then the answer.

    Each line is `{"step", "state", "detail"}`, with step one of tables, sql, query,
    answer, chart, cost or note; the last is `{"step": "result", "state": "done",
    "answer": ...}`, or `{"step": "error", ...}`. The question runs in a worker
    thread; its steps reach the stream through the event loop, in the order they
    happened.
    """
    if not ask_data.enabled():
        raise HTTPException(404, "live questions are off on this server")
    from ..series.bigquery import Ledger

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    def say(step: str, state: str, detail: dict[str, Any]) -> None:
        loop.call_soon_threadsafe(
            queue.put_nowait, {"step": step, "state": state, "detail": detail}
        )

    def failed(message: str) -> dict[str, Any]:
        return {"step": "error", "state": "failed", "detail": {"message": message[:300]}}

    async def run() -> None:
        try:
            answer = await asyncio.to_thread(ask_data.ask, q.question, ledger=Ledger(), on_step=say)
            queue.put_nowait({"step": "result", "state": "done", "answer": answer})
        except (ask_data.AskLimited, ValueError) as exc:
            queue.put_nowait(failed(str(exc)))
        except Exception as exc:  # noqa: BLE001 - the stream has started: report it in the stream
            queue.put_nowait(failed(f"the data agent did not answer: {type(exc).__name__}: {exc}"))
        finally:
            queue.put_nowait(None)

    task = asyncio.create_task(run())

    async def lines() -> AsyncIterator[str]:
        while (item := await queue.get()) is not None:
            yield json.dumps(item, default=str) + "\n"
        await task

    return StreamingResponse(lines(), media_type="application/x-ndjson")
