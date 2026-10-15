"""Ask the data: a question in plain words, answered by Google's data agent over BigQuery.

The Conversational Analytics API (Gemini Data Analytics) reads the `crux_ts`
tables, writes the SQL, runs it and answers with text, the rows and a chart
spec. Stateless: the tables and the instructions go with every question, so
nothing is stored on Google's side. Each of its queries is capped at
`ASK_MAX_BYTES`, the bytes it billed go into the same ledger as the Google run,
and a server answers at most `ASK_PER_HOUR` questions an hour.

It answers about readings, never about what is wrong with a machine: the
instructions say so, and nothing it says reaches an investigation.

The agent streams its work: progress notes while it reads the tables, writes
the SQL and runs it, then the answer, the rows and a chart. `read` folds that
stream into phases (tables, sql, query, answer, chart) and reports each as it
opens and closes, so a page can draw the work instead of a spinner.
"""

from __future__ import annotations

import os
import threading
import time
from collections import deque
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from typing import Any

from .settings import DATASET, DEFAULT_LOCATION

#: Tables the agent may read. The one-minute table is left out: an hour or a
#: quarter-hour answers any question a planner asks, for a tenth of the bytes.
TABLES = ("metro_60min", "metro_15min", "ims_health")

#: Per query the agent runs; a query over it fails without charge. 100 MB is the
#: example in Google's cost guide and is ten times the largest table here.
ASK_MAX_BYTES = 100 * 1024 * 1024
ASK_PER_HOUR = 60
#: The API's location (Conversational Analytics overview: `global` or `us`).
ASK_LOCATION = "global"

MAX_ROWS = 500

INSTRUCTION = f"""You answer questions about sensor history for maintenance planners.
Tables in dataset {DATASET}:
- metro_60min and metro_15min: a metro train's air compressor (MetroPT-3, Portugal,
  1 Feb to 1 Sep 2020), hourly and 15-minute means. ts is the start of each step, in
  the recording's own clock. loaded = percent of the step the compressor ran loaded;
  motor_current in amperes (about 0.04 A off, 3.7 A idle, 5.6 A loaded); oil_temp in
  degrees C; tp3 and reservoirs are pressures in bar; towers = which air dryer tower
  worked (0 or 1). filled = true means nothing was recorded then and the row copies
  the day before: always leave filled rows out.
- ims_health: NASA IMS bearing run-to-failure tests. run_id names a bearing; ts is a
  regular 10-minute clock from an arbitrary start (2000-01-01), minute is the real
  minutes from the start; rms is vibration RMS in g, kurtosis is unitless (3 is normal noise).
The company reported four air leaks: 18 Apr 2020 all day; 29 May 23:30 to 30 May 06:00;
5 Jun 10:00 to 7 Jun 14:30; 15 Jul 14:30 to 19:00.
Say what the readings show. Never diagnose a cause or recommend a repair. Keep answers short and plain."""

#: Questions answered once by the Google run and saved, so the tab shows real
#: answers on a server that does not take live questions.
EXAMPLES = (
    "How did the compressor's average loaded share change week by week from April to July 2020?",
    "List the five days with the highest average motor current, with their averages.",
    "Compare the bearings in ims_health: which one's RMS rose the most between its first and last day?",
)


class AskLimited(RuntimeError):
    pass


_RECENT: deque[float] = deque()
_LOCK = threading.Lock()


def enabled() -> bool:
    return os.getenv("CRUX_SERIES_ASK", "").strip().lower() in {"1", "true", "yes"}


def _take_slot() -> None:
    now = time.monotonic()
    with _LOCK:
        while _RECENT and now - _RECENT[0] > 3600:
            _RECENT.popleft()
        if len(_RECENT) >= ASK_PER_HOUR:
            raise AskLimited(f"this server answers at most {ASK_PER_HOUR} questions an hour")
        _RECENT.append(now)


#: Reports one phase of the agent's work: (phase, "start" | "done" | "note", detail).
OnStep = Callable[[str, str, dict[str, Any]], None]


class _Phases:
    """Each phase opens once and closes once, in order, whichever message tells of it first."""

    def __init__(self, on_step: OnStep | None) -> None:
        self.say = on_step or (lambda *_: None)
        self.state: dict[str, str] = {}

    def start(self, name: str, **detail: Any) -> None:
        if name not in self.state:
            self.state[name] = "start"
            self.say(name, "start", detail)

    def done(self, name: str, **detail: Any) -> None:
        if self.state.get(name) != "done":
            self.start(name)
            self.state[name] = "done"
            self.say(name, "done", detail)


def _thought(phases: _Phases, title: str, note: str) -> None:
    """A progress note, by its title. Google's wording as seen on 14 Oct 2026: "Analyzing
    context", "Context retrieved", "Running a query" (the SQL as its note) and "Query
    execution completed". A title not listed passes through as a note; the data
    messages that follow close whatever phase it left open."""
    t = title.strip().lower()
    if t.startswith("analyzing context"):
        phases.start("tables", note=note)
    elif t.startswith("context retrieved"):
        phases.done("tables", note=note)
        phases.start("sql")
    elif t.startswith("running a query"):
        phases.done("sql", lines=_lines(note))
        phases.start("query")
    elif t.startswith("query execution completed"):
        phases.done("query", note=note)
        phases.start("answer")
    else:
        phases.say("note", "note", {"title": title, "note": note})


def _lines(sql: str) -> int:
    return len([x for x in sql.splitlines() if x.strip()])


def read(messages: Iterable[dict[str, Any]], on_step: OnStep | None = None) -> dict[str, Any]:
    """Fold the agent's stream (each message as a dict) into one answer."""
    phases = _Phases(on_step)
    answer: list[str] = []
    steps: list[str] = []
    followups: list[str] = []
    sql = ""
    columns: list[str] = []
    rows: list[list[Any]] = []
    chart: dict[str, Any] | None = None
    jobs: list[tuple[str, str]] = []
    for msg in messages:
        d = msg.get("systemMessage", msg)
        if "text" in d:
            parts = d["text"].get("parts", [])
            kind = d["text"].get("textType", "")
            if kind == "FINAL_RESPONSE":
                phases.start("answer")
                answer.extend(parts)
            elif kind == "THOUGHT" and parts:
                steps.append(parts[0])
                _thought(phases, parts[0], parts[1] if len(parts) > 1 else "")
            elif kind == "FOLLOWUP_QUESTIONS":
                followups = list(parts)
        data = d.get("data", {})
        if data.get("generatedSql"):
            sql = data["generatedSql"]
            phases.done("sql", lines=_lines(sql))
        if "bigQueryJob" in data:
            job = data["bigQueryJob"]
            jobs.append((job.get("jobId", ""), job.get("location", DEFAULT_LOCATION)))
            phases.start("query")
        if "result" in data:
            fields = data["result"].get("schema", {}).get("fields", [])
            columns = [f["name"] for f in fields]
            rows = [[r.get(c) for c in columns] for r in data["result"].get("data", [])[:MAX_ROWS]]
            phases.done("query", rows=len(rows))
        if "chart" in d:
            phases.start("chart")
            vega = d["chart"].get("result", {}).get("vegaConfig")
            if vega:
                chart = vega
                phases.done("chart")
    if answer:
        phases.done("answer")
    return {
        "answer": "\n\n".join(answer).strip(),
        "steps": steps,
        "sql": sql,
        "columns": columns,
        "rows": rows,
        "chart": chart,
        "followups": followups,
        "jobs": jobs,
    }


def ask(
    question: str,
    project: str | None = None,
    ledger: Any | None = None,
    on_step: OnStep | None = None,
) -> dict[str, Any]:
    """One question, one answer. Raises RuntimeError when the extra or the login is missing."""
    question = question.strip()
    if not 3 <= len(question) <= 500:
        raise ValueError("a question is 3 to 500 characters")
    try:
        from google.cloud import geminidataanalytics as g
        from google.protobuf import json_format
    except ImportError as e:
        raise RuntimeError("Ask the data needs the series extra: uv sync --extra series") from e
    project = project or os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT is not set")
    _take_slot()

    ctx = g.Context()
    ctx.system_instruction = INSTRUCTION
    ctx.datasource_references = g.DatasourceReferences(
        bq=g.BigQueryTableReferences(
            table_references=[
                g.BigQueryTableReference(project_id=project, dataset_id=DATASET, table_id=t)
                for t in TABLES
            ]
        )
    )
    ctx.options.datasource.big_query_max_billed_bytes = ASK_MAX_BYTES
    request = g.ChatRequest(
        parent=f"projects/{project}/locations/{ASK_LOCATION}",
        messages=[g.Message(user_message=g.UserMessage(text=question))],
        inline_context=ctx,
    )
    started = time.monotonic()
    stream = (
        json_format.MessageToDict(type(m).pb(m))
        for m in g.DataChatServiceClient().chat(request=request, timeout=300)
    )
    got = read(stream, on_step)
    billed = _billed(project, got.pop("jobs"), ledger, question)
    if on_step and billed:
        on_step("cost", "done", billed)
    sql = got["sql"]
    return {
        "question": question,
        **got,
        "made": {
            "engine": "bigquery",
            "model": "Gemini data agent",
            "product": "Conversational Analytics API",
            "sql": sql,
            "settings": {
                "tables": list(TABLES),
                "max_bytes_billed": ASK_MAX_BYTES,
                "location": ASK_LOCATION,
            },
            "computed_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "cost": billed,
            "seconds": round(time.monotonic() - started, 1),
        },
    }


def _billed(
    project: str, jobs: list[tuple[str, str]], ledger: Any | None, question: str
) -> dict[str, Any]:
    """What the agent's queries billed, read back from BigQuery, into the ledger."""
    seen = {j for j in jobs if j[0]}
    if not seen:
        return {}
    try:
        from google.cloud import bigquery

        from .bigquery import usd

        client = bigquery.Client(project=project)
        total = 0
        for job_id, location in seen:
            total += int(client.get_job(job_id, location=location).total_bytes_billed or 0)
    except Exception as exc:  # noqa: BLE001 - the answer stands; the cost is unknown
        return {"error": f"{type(exc).__name__}"}
    cost = {"billed_bytes": total, "usd": round(usd(total, "query"), 6)}
    if ledger is not None:
        ledger.add(
            {
                "at": datetime.now(UTC).isoformat(timespec="seconds"),
                "label": "ask: " + question[:60],
                "kind": "query",
                "job": ",".join(j for j, _ in seen),
                "estimated_bytes": total,
                "billed_bytes": total,
                "usd": usd(total, "query"),
            }
        )
    return cost
