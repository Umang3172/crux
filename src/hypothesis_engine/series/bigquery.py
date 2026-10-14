"""The Google run: the prepared tables in BigQuery, and every view computed there.

- TimesFM 3.0 through `AI.FORECAST`: three compressor signals at once, with the
  pressures as past helpers and the clock and the day as future helpers. One
  query per span answers every "as of" moment (`id_cols => ['preset']`).
- TimesFM 3.0 through `AI.DETECT_ANOMALIES`: one series per moment and signal.
- `ARIMA_PLUS`: one model holding a series per moment and signal, each cut at
  its own "as of"; `ML.EXPLAIN_FORECAST` gives two weeks ahead and the parts.
- Contribution analysis: one model per leak moment, its week against the
  normal week, read with `ML.GET_INSIGHTS`.

Every SQL string is built by a function here from checked settings only, and
what ran is saved with the view it made. `Runner` dry-runs each job first,
keeps a ledger of what was spent, refuses a job that would take the ledger past
`BUDGET_USD`, and caps every job at `MAX_BYTES_BILLED` (a job over it fails
without charge). Needs the `series` extra and Google Cloud's login.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from . import snapshot, sources, summary, views
from .offline import METRIC
from .settings import (
    ANOMALY_PROB,
    BUDGET_USD,
    CHANGE_DIMENSIONS,
    CHUNK_H,
    CONFIDENCE,
    CONTEXT,
    CONTROL_PRESET,
    DATASET,
    DEFAULT_LOCATION,
    FUTURE_COVARIATES,
    IMS_CADENCE_MIN,
    IMS_CHECK_POINTS,
    IMS_MIN_HISTORY,
    IMS_PRESETS,
    IMS_SIGNALS,
    LEDGER_FILE,
    MAX_BYTES_BILLED,
    METRO_PAST,
    METRO_PRESETS,
    METRO_TARGETS,
    MIN_SUPPORT,
    MODEL_USD_PER_TIB,
    OFF_BELOW_A,
    QUERY_USD_PER_TIB,
    TOP_CHANGES,
    WINDOW_AFTER_H,
    WINDOW_BEFORE_H,
    WINDOW_CADENCE_MIN,
    Preset,
    Span,
    preset,
    span,
)

MODEL = "TimesFM 3.0"
#: Targets plus helpers AI.FORECAST accepts in Preview (BigQuery, 14 Oct 2026).
MAX_COLUMNS = 6
TIB = float(1 << 40)
#: BigQuery bills at least 10 MB for each table a query reads (on-demand).
MIN_BILLED = 10 * 1024 * 1024
#: ARIMA_PLUS fits several candidate models per series, and model creation may
#: be billed per candidate. The estimate assumes the most (42, at the largest
#: auto-ARIMA order) so the guard errs high.
ARIMA_CANDIDATES = 42

_PROJECT = re.compile(r"^[a-z][a-z0-9-]{4,61}[a-z0-9]$")
_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,1023}$")
_ID = re.compile(r"^[a-z0-9/_]+$")


@dataclass(frozen=True)
class Where:
    """A BigQuery dataset, checked before it is formatted into any SQL."""

    project: str
    dataset: str = DATASET

    def __post_init__(self) -> None:
        if not _PROJECT.match(self.project):
            raise ValueError(f"not a Google Cloud project id: {self.project!r}")
        if not _NAME.match(self.dataset):
            raise ValueError(f"not a dataset name: {self.dataset!r}")

    def table(self, name: str) -> str:
        if not _NAME.match(name):
            raise ValueError(f"not a table name: {name!r}")
        return f"`{self.project}.{self.dataset}.{name}`"


def _ts(when: np.datetime64) -> str:
    return "TIMESTAMP '" + str(np.datetime64(when, "m")).replace("T", " ") + ":00'"


def _presets_cte(presets: Sequence[Preset]) -> str:
    rows = []
    for p in presets:
        if not _ID.match(p.id):
            raise ValueError(f"not a preset id: {p.id!r}")
        rows.append(f"STRUCT('{p.id}' AS preset, {_ts(views.as_of(p))} AS as_of)")
    return "presets AS (\n  SELECT * FROM UNNEST([\n    " + ",\n    ".join(rows) + "\n  ])\n)"


def _unpivot(alias: str, signals: Iterable[str]) -> str:
    parts = [f"STRUCT('{s}' AS signal, {alias}.{s} AS v)" for s in signals]
    return "UNNEST([" + ", ".join(parts) + "])"


def _clock(ts: str = "ts") -> str:
    """The future helpers: the time of day as a point on a circle."""
    minute = f"(EXTRACT(HOUR FROM {ts}) * 60 + EXTRACT(MINUTE FROM {ts}))"
    known = {
        "hour_sin": f"SIN(2 * ACOS(-1) * {minute} / 1440) AS hour_sin",
        "hour_cos": f"COS(2 * ACOS(-1) * {minute} / 1440) AS hour_cos",
    }
    return ",\n    ".join(known[c] for c in FUTURE_COVARIATES)


def forecast_sql(
    where: Where, sp: Span, presets: Sequence[Preset] = METRO_PRESETS, context: int = CONTEXT
) -> str:
    """TimesFM 3.0, three targets with past and future helpers, every moment in one query.

    The context is the `context` steps before "as of" (a step labelled by its
    start, so the step at "as of" is the first forecast, never history). The
    rows ahead carry the clock only: targets and past helpers are NULL there,
    as AI.FORECAST's covariate example does.
    """
    if sp.model != MODEL:
        raise ValueError(f"{sp.id} is not a TimesFM span")
    if not 1 <= sp.horizon <= 1024:
        raise ValueError("horizon is 1..1024 (TimesFM 3.0's limit)")
    if context % 32 or not 64 <= context <= 2048:
        raise ValueError("context is n*32 from 64 to 2048 (TimesFM 3.0's limit)")
    if len(METRO_TARGETS) + len(METRO_PAST) + len(FUTURE_COVARIATES) > MAX_COLUMNS:
        raise ValueError(f"AI.FORECAST takes at most {MAX_COLUMNS} targets and helpers")
    table = where.table(f"metro_{sp.cadence_min}min")
    cols = [s.id for s in METRO_TARGETS] + [s.id for s in METRO_PAST]
    nulls = ", ".join(f"CAST(NULL AS FLOAT64) AS {c}" for c in cols)
    targets = ", ".join(f"'{s.id}'" for s in METRO_TARGETS)
    past = ", ".join(f"'{s.id}'" for s in METRO_PAST)
    future = ", ".join(f"'{c}'" for c in FUTURE_COVARIATES)
    return f"""
WITH {_presets_cte(presets)},
past AS (
  SELECT p.preset, m.ts, {", ".join("m." + c for c in cols)}
  FROM presets AS p
  JOIN {table} AS m
    ON m.ts >= TIMESTAMP_SUB(p.as_of, INTERVAL {context * sp.cadence_min} MINUTE)
   AND m.ts < p.as_of
),
ahead AS (
  SELECT p.preset, TIMESTAMP_ADD(p.as_of, INTERVAL k * {sp.cadence_min} MINUTE) AS ts, {nulls}
  FROM presets AS p, UNNEST(GENERATE_ARRAY(0, {sp.horizon - 1})) AS k
),
series AS (
  SELECT *,
    {_clock()}
  FROM (SELECT * FROM past UNION ALL SELECT * FROM ahead)
)
SELECT * FROM AI.FORECAST(
  (SELECT * FROM series),
  target_cols => [{targets}],
  timestamp_col => 'ts',
  model => '{MODEL}',
  id_cols => ['preset'],
  horizon => {sp.horizon},
  confidence_level => {CONFIDENCE},
  context_window => {context},
  past_covariate_cols => [{past}],
  future_covariate_cols => [{future}]
)
"""


def anomalies_sql(
    where: Where, presets: Sequence[Preset] = METRO_PRESETS, context: int = CONTEXT
) -> str:
    """TimesFM 3.0's anomaly check on each moment's week, a day at a time.

    Each day of the week is held to what TimesFM expected from the history
    before that day began, as a daily batch job would run. Checked as one
    stretch, the end of the week sat a week ahead of its history and its band
    grew wide enough to hide the leak (seen 14 Oct 2026). One series per moment,
    signal and day; one query for all of them.
    """
    table = where.table(f"metro_{WINDOW_CADENCE_MIN}min")
    days = (WINDOW_BEFORE_H + WINDOW_AFTER_H) // CHUNK_H
    return f"""
WITH {_presets_cte(presets)},
days AS (
  SELECT p.preset, CAST(d AS STRING) AS day,
    TIMESTAMP_ADD(TIMESTAMP_SUB(p.as_of, INTERVAL {WINDOW_BEFORE_H} HOUR), INTERVAL {CHUNK_H} * d HOUR) AS start
  FROM presets AS p, UNNEST(GENERATE_ARRAY(0, {days - 1})) AS d
),
long AS (
  SELECT y.preset, y.day, s.signal, m.ts, s.v, m.ts >= y.start AS checked
  FROM days AS y
  JOIN {table} AS m
    ON m.ts >= TIMESTAMP_SUB(y.start, INTERVAL {context * WINDOW_CADENCE_MIN} MINUTE)
   AND m.ts < TIMESTAMP_ADD(y.start, INTERVAL {CHUNK_H} HOUR)
  CROSS JOIN {_unpivot("m", [s.id for s in METRO_TARGETS])} AS s
)
SELECT * FROM AI.DETECT_ANOMALIES(
  (SELECT preset, signal, day, ts, v FROM long WHERE NOT checked),
  (SELECT preset, signal, day, ts, v FROM long WHERE checked),
  data_col => 'v',
  timestamp_col => 'ts',
  id_cols => ['preset', 'signal', 'day'],
  model => '{MODEL}',
  anomaly_prob_threshold => {ANOMALY_PROB},
  context_window => {context}
)
"""


def ims_starts(run_id: str) -> list[np.datetime64]:
    """Where each day of a failed bearing's checked stretch begins, in its BigQuery clock."""
    run = sources.ims_runs()[run_id]
    n = len(run.minutes)
    t = sources.ims_time(n)
    first = sources.ims_check_start(n, IMS_CHECK_POINTS, IMS_MIN_HISTORY)
    per_day = CHUNK_H * 60 // IMS_CADENCE_MIN
    return [t[i] for i in range(first, n, per_day)]


def ims_anomalies_sql(
    where: Where, run_id: str, starts: Sequence[np.datetime64], context: int = CONTEXT
) -> str:
    """One bearing per query, its last week a day at a time (see `anomalies_sql`)."""
    if not _ID.match(run_id):
        raise ValueError(f"not a run id: {run_id!r}")
    rows = ", ".join(f"STRUCT('{k}' AS day, {_ts(t)} AS start)" for k, t in enumerate(starts))
    return f"""
WITH days AS (SELECT * FROM UNNEST([{rows}])),
long AS (
  SELECT '{run_id}' AS preset, y.day, s.signal, h.ts, s.v, h.ts >= y.start AS checked
  FROM days AS y
  JOIN {where.table("ims_health")} AS h
    ON h.run_id = '{run_id}'
   AND h.ts >= TIMESTAMP_SUB(y.start, INTERVAL {context * IMS_CADENCE_MIN} MINUTE)
   AND h.ts < TIMESTAMP_ADD(y.start, INTERVAL {CHUNK_H} HOUR)
  CROSS JOIN {_unpivot("h", [s.id for s in IMS_SIGNALS])} AS s
)
SELECT * FROM AI.DETECT_ANOMALIES(
  (SELECT preset, signal, day, ts, v FROM long WHERE NOT checked),
  (SELECT preset, signal, day, ts, v FROM long WHERE checked),
  data_col => 'v',
  timestamp_col => 'ts',
  id_cols => ['preset', 'signal', 'day'],
  model => '{MODEL}',
  anomaly_prob_threshold => {ANOMALY_PROB},
  context_window => {context}
)
"""


ARIMA_MODEL = "metro_arima"


def arima_create_sql(where: Where, presets: Sequence[Preset] = METRO_PRESETS) -> str:
    """One ARIMA_PLUS model: a series per moment and signal, each ending at its "as of".

    Filled hours are left out: ARIMA_PLUS fills its own gaps, and copies of the
    day before would read to it as a real pattern.
    """
    sp = span("2w")
    return f"""
CREATE OR REPLACE MODEL {where.table(ARIMA_MODEL)}
OPTIONS (
  model_type = 'ARIMA_PLUS',
  time_series_timestamp_col = 'ts',
  time_series_data_col = 'v',
  time_series_id_col = 'series',
  data_frequency = 'HOURLY',
  horizon = {sp.horizon},
  decompose_time_series = TRUE
) AS
WITH {_presets_cte(presets)}
SELECT CONCAT(p.preset, '/', s.signal) AS series, m.ts, s.v
FROM presets AS p
JOIN {where.table("metro_60min")} AS m ON m.ts < p.as_of AND NOT m.filled
CROSS JOIN {_unpivot("m", [s.id for s in METRO_TARGETS])} AS s
"""


def explain_sql(where: Where, presets: Sequence[Preset] = METRO_PRESETS) -> str:
    sp = span("2w")
    return f"""
WITH {_presets_cte(presets)}
SELECT e.*
FROM ML.EXPLAIN_FORECAST(
  MODEL {where.table(ARIMA_MODEL)},
  STRUCT({sp.horizon} AS horizon, {CONFIDENCE} AS confidence_level)
) AS e
JOIN presets AS p ON p.preset = SPLIT(e.series, '/')[OFFSET(0)]
WHERE e.time_series_timestamp >= TIMESTAMP_SUB(p.as_of, INTERVAL {sp.shown} HOUR)
ORDER BY e.series, e.time_series_timestamp
"""


def arima_evaluate_sql(where: Where) -> str:
    return f"""
SELECT * FROM ML.ARIMA_EVALUATE(
  MODEL {where.table(ARIMA_MODEL)},
  STRUCT(FALSE AS show_all_candidate_models)
)
"""


def changes_model(p: Preset) -> str:
    return "metro_changes_" + p.id


def _window_sql(p: Preset, col: str = "ts") -> str:
    t0, t1 = views.window(p)
    return f"({col} >= {_ts(t0)} AND {col} < {_ts(t1)})"


def changes_create_sql(where: Where, p: Preset) -> str:
    """Contribution analysis: this moment's week against the normal week.

    The metric is a summable ratio, loaded minutes over running minutes, so a
    week with fewer trains is not read as a change (settings). The dimension
    rules match `offline.dimensions`.
    """
    control = preset("metro", CONTROL_PRESET)
    if p.id == control.id:
        raise ValueError("the control week is not compared with itself")
    dims = ", ".join(f"'{d}'" for d in CHANGE_DIMENSIONS)
    return f"""
CREATE OR REPLACE MODEL {where.table(changes_model(p))}
OPTIONS (
  model_type = 'CONTRIBUTION_ANALYSIS',
  contribution_metric = 'SUM(loaded_min)/SUM(running_min)',
  dimension_id_cols = [{dims}],
  is_test_col = 'is_test',
  min_apriori_support = {MIN_SUPPORT}
) AS
SELECT
  loaded / 100 AS loaded_min,
  1.0 AS running_min,
  CASE DIV(EXTRACT(HOUR FROM ts), 6)
    WHEN 0 THEN '00-06' WHEN 1 THEN '06-12' WHEN 2 THEN '12-18' ELSE '18-24' END AS hour_band,
  IF(EXTRACT(DAYOFWEEK FROM ts) IN (1, 7), 'weekend', 'weekday') AS day_type,
  IF(towers >= 0.5, 'tower_1', 'tower_0') AS dryer_tower,
  {_window_sql(p)} AS is_test
FROM {where.table("metro_1min")}
WHERE NOT filled
  AND motor_current >= {OFF_BELOW_A}
  AND ({_window_sql(p)} OR {_window_sql(control)})
"""


def insights_sql(where: Where, p: Preset) -> str:
    return f"""
SELECT * FROM ML.GET_INSIGHTS(MODEL {where.table(changes_model(p))})
ORDER BY contribution DESC
"""


# Running jobs, with the spend guard.


class BudgetExceeded(RuntimeError):
    pass


def usd(n_bytes: float, kind: str) -> float:
    rate = MODEL_USD_PER_TIB if kind == "model" else QUERY_USD_PER_TIB
    return float(n_bytes) / TIB * rate


@dataclass
class Ledger:
    """What the Google run has spent, kept across runs in a JSON file."""

    path: Path = LEDGER_FILE

    def entries(self) -> list[dict[str, Any]]:
        if not self.path.is_file():
            return []
        return json.loads(self.path.read_text())

    def spent(self) -> float:
        return sum(e.get("usd", 0.0) for e in self.entries())

    def add(self, entry: dict[str, Any]) -> None:
        rows = self.entries() + [entry]
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(rows, indent=1))


class Runner:
    """Runs SQL on BigQuery with Google Cloud's login, under the spend guard."""

    def __init__(
        self,
        project: str | None = None,
        location: str | None = None,
        dataset: str = DATASET,
        ledger: Ledger | None = None,
        budget: float = BUDGET_USD,
        dry_only: bool = False,
    ) -> None:
        try:
            from google.cloud import bigquery
        except ImportError as e:
            raise RuntimeError(
                "the Google run needs the series extra: uv sync --extra series"
            ) from e
        self.bq = bigquery
        self.client = bigquery.Client(
            project=project or os.environ.get("GOOGLE_CLOUD_PROJECT") or None,
            location=location or os.environ.get("BIGQUERY_LOCATION", DEFAULT_LOCATION),
        )
        self.where = Where(self.client.project, dataset)
        self.location = self.client.location
        self.ledger = ledger or Ledger()
        self.budget = budget
        self.dry_only = dry_only
        self.planned = 0.0  # dry-run estimates of this run, when dry_only

    def estimate(self, sql: str, kind: str) -> tuple[int, float]:
        cfg = self.bq.QueryJobConfig(dry_run=True, use_query_cache=False)
        job = self.client.query(sql, job_config=cfg)
        n = max(int(job.total_bytes_processed or 0), MIN_BILLED)
        if kind == "model" and "ARIMA_PLUS" in sql:
            n *= ARIMA_CANDIDATES
        return n, usd(n, kind)

    def query(self, sql: str, label: str, kind: str = "query") -> list[dict[str, Any]]:
        try:
            n, est = self.estimate(sql, kind)
        except Exception as exc:
            # A dry run of a query that reads a model not yet created fails; such a
            # query reads only the model. A real run never gets here, because the
            # model is made by the job before it.
            if self.dry_only and "Not found: Model" in str(exc):
                print(f"  {label}: reads a model this dry run has not made; not estimated")
                return []
            raise
        spent = self.ledger.spent() + self.planned
        if spent + est > self.budget:
            raise BudgetExceeded(
                f"{label}: estimated ${est:.3f} would take the spend to ${spent + est:.2f}, past ${self.budget:.2f}"
            )
        print(f"  {label}: up to {n / 1e6:.0f} MB, at most ${est:.4f} (spent so far ${spent:.4f})")
        if self.dry_only:
            self.planned += est
            return []
        cfg = self.bq.QueryJobConfig(maximum_bytes_billed=MAX_BYTES_BILLED)
        job = self.client.query(sql, job_config=cfg)
        rows = [dict(r.items()) for r in job.result()]
        billed = int(job.total_bytes_billed or 0)
        self.ledger.add(
            {
                "at": datetime.now(UTC).isoformat(timespec="seconds"),
                "label": label,
                "kind": kind,
                "job": job.job_id,
                "estimated_bytes": n,
                "billed_bytes": billed,
                "usd": usd(billed, kind),
            }
        )
        print(f"    billed {billed / 1e6:.1f} MB = ${usd(billed, kind):.4f}")
        return rows

    def cost(self, label: str) -> dict[str, Any]:
        """The ledger's entry for a job, for the view it made."""
        for e in reversed(self.ledger.entries()):
            if e["label"] == label:
                return {
                    "billed_bytes": e["billed_bytes"],
                    "usd": round(e["usd"], 5),
                    "job": e["job"],
                }
        return {}

    def upload(self) -> None:
        """Create the dataset and load the prepared tables. Load jobs are free."""
        bq = self.bq
        ds = bq.Dataset(f"{self.where.project}.{self.where.dataset}")
        ds.location = self.location
        ds.description = (
            "Crux Trends: sensor history for TimesFM 3.0, ARIMA_PLUS and contribution analysis"
        )
        self.client.create_dataset(ds, exists_ok=True)
        metro_schema = (
            [bq.SchemaField("ts", "TIMESTAMP", description=DESCRIBE["ts"])]
            + [
                bq.SchemaField(c, "FLOAT64", description=DESCRIBE.get(c, ""))
                for c in _metro_columns()
            ]
            + [bq.SchemaField("filled", "BOOL", description=DESCRIBE["filled"])]
        )
        jobs = [(f"metro_{c}min", sources.metro_path(c), metro_schema) for c in sources.CADENCES]
        if sources.IMS_SERIES.is_file():
            jobs.append(
                (
                    "ims_health",
                    sources.IMS_SERIES,
                    [
                        bq.SchemaField(
                            "run_id", "STRING", description="One bearing of one NASA IMS test"
                        ),
                        bq.SchemaField(
                            "ts",
                            "TIMESTAMP",
                            description="Regular 10-minute clock from 2000-01-01, not a real date",
                        ),
                        bq.SchemaField(
                            "minute", "FLOAT64", description="Real minutes since the test started"
                        ),
                        bq.SchemaField("rms", "FLOAT64", description="Vibration RMS, g"),
                        bq.SchemaField(
                            "kurtosis",
                            "FLOAT64",
                            description="Kurtosis; 3 for plain noise, impacts push it up",
                        ),
                    ],
                )
            )
        for name, path, schema in jobs:
            if self.dry_only:
                print(f"  would load {path.name} into {name}")
                continue
            cfg = bq.LoadJobConfig(
                source_format=bq.SourceFormat.CSV,
                skip_leading_rows=1,
                schema=schema,
                write_disposition=bq.WriteDisposition.WRITE_TRUNCATE,
            )
            with path.open("rb") as fh:
                job = self.client.load_table_from_file(
                    fh, f"{self.where.project}.{self.where.dataset}.{name}", job_config=cfg
                )
            job.result()
            print(f"  loaded {name}: {job.output_rows} rows (load jobs are free)")


#: Column descriptions stored in BigQuery, which the data agent reads.
DESCRIBE = {
    "ts": "Start of the step, in the recording's own clock (no time zone recorded)",
    "loaded": "Percent of the step the compressor ran loaded (DV_eletric on)",
    "motor_current": "Mean motor current, A: about 0.04 off, 3.7 idle, 5.6 loaded",
    "oil_temp": "Mean oil temperature, degrees C",
    "tp3": "Mean pneumatic panel pressure, bar",
    "reservoirs": "Mean air reservoir pressure, bar",
    "towers": "Which air dryer tower worked (0 or 1), mean over the step",
    "filled": "True when nothing was recorded: the row copies the same time a day earlier",
}


def _metro_columns() -> list[str]:
    with sources.metro_path(1).open() as fh:
        head = fh.readline().strip().split(",")
    return head[1:-1]


# Turning rows into views.


def _np_ts(x: Any) -> np.datetime64:
    """A BigQuery TIMESTAMP (an aware datetime) as a naive minute in the dataset's clock."""
    return np.datetime64(x.astimezone(UTC).replace(tzinfo=None), "m")


def parse_forecast(
    rows: list[dict[str, Any]], presets: Sequence[Preset]
) -> dict[str, dict[str, views.Band]]:
    out: dict[str, dict[str, views.Band]] = {}
    for p in presets:
        mine = sorted(
            (
                r
                for r in rows
                if r["preset"] == p.id and r.get("time_series_type", "forecast") == "forecast"
            ),
            key=lambda r: r["ts"],
        )
        mine = [r for r in mine if _np_ts(r["ts"]) >= views.as_of(p)]
        status = {r.get("ai_forecast_status") for r in mine} - {None, ""}
        if status:
            raise RuntimeError(f"AI.FORECAST for {p.id}: {sorted(status)}")
        t = np.array([_np_ts(r["ts"]) for r in mine])
        out[p.id] = {}
        for s in METRO_TARGETS:
            col = [r[s.id] for r in mine]
            out[p.id][s.id] = views.Band(
                t,
                np.array([c["value"] for c in col], dtype=float),
                np.array([c["prediction_interval_lower_bound"] for c in col], dtype=float),
                np.array([c["prediction_interval_upper_bound"] for c in col], dtype=float),
            )
    return out


def parse_anomalies(
    rows: list[dict[str, Any]],
    ids: Sequence[str],
    signals: Sequence[str],
    filled: Callable[[np.ndarray], np.ndarray] | None,
) -> dict[str, dict[str, views.Flags]]:
    out: dict[str, dict[str, views.Flags]] = {}
    for pid in ids:
        out[pid] = {}
        for sig in signals:
            mine = sorted(
                (r for r in rows if r["preset"] == pid and r["signal"] == sig),
                key=lambda r: r["time_series_timestamp"],
            )
            status = {r.get("ai_detect_anomalies_status") for r in mine} - {None, ""}
            if status:
                raise RuntimeError(f"AI.DETECT_ANOMALIES for {pid}/{sig}: {sorted(status)}")
            t = np.array([_np_ts(r["time_series_timestamp"]) for r in mine])
            out[pid][sig] = views.Flags(
                t,
                np.array([r["time_series_data"] for r in mine], dtype=float),
                np.array([r["lower_bound"] for r in mine], dtype=float),
                np.array([r["upper_bound"] for r in mine], dtype=float),
                np.array([bool(r["is_anomaly"]) for r in mine]),
                np.array([r["anomaly_probability"] for r in mine], dtype=float),
                filled(t) if filled is not None else None,
            )
    return out


#: ML.EXPLAIN_FORECAST's columns, by the name the breakdown uses.
_EXPLAIN = {
    "trend": "trend",
    "daily": "seasonal_period_daily",
    "weekly": "seasonal_period_weekly",
    "spikes_and_dips": "spikes_and_dips",
    "step_changes": "step_changes",
    "residual": "residual",
}


def _f(x: Any) -> float:
    return float("nan") if x is None else float(x)


def parse_explain(
    rows: list[dict[str, Any]], evaluate: list[dict[str, Any]], presets: Sequence[Preset]
) -> dict[str, dict[str, views.Parts]]:
    chosen = {r["series"]: r for r in evaluate}
    out: dict[str, dict[str, views.Parts]] = {}
    for p in presets:
        out[p.id] = {}
        for s in METRO_TARGETS:
            key = f"{p.id}/{s.id}"
            mine = [r for r in rows if r["series"] == key]
            t = np.array([_np_ts(r["time_series_timestamp"]) for r in mine])
            hist = np.array([r["time_series_type"] == "history" for r in mine])
            fc = [r for r in mine if r["time_series_type"] == "forecast"]
            parts = {
                name: np.array([_f(r.get(col)) for r in mine]) for name, col in _EXPLAIN.items()
            }
            ev = chosen.get(key, {})
            model = {
                k: (v if not isinstance(v, (list, tuple)) else list(v))
                for k, v in ev.items()
                if k
                in (
                    "non_seasonal_p",
                    "non_seasonal_d",
                    "non_seasonal_q",
                    "has_drift",
                    "seasonal_periods",
                    "has_spikes_and_dips",
                    "has_step_changes",
                    "AIC",
                )
            }
            if "AIC" in model and model["AIC"] is not None:
                model["AIC"] = views.num(model["AIC"], 6)
            out[p.id][s.id] = views.Parts(
                t,
                np.where(hist, np.array([_f(r["time_series_data"]) for r in mine]), np.nan),
                parts,
                views.Band(
                    np.array([_np_ts(r["time_series_timestamp"]) for r in fc]),
                    np.array([_f(r["time_series_data"]) for r in fc]),
                    np.array([_f(r["prediction_interval_lower_bound"]) for r in fc]),
                    np.array([_f(r["prediction_interval_upper_bound"]) for r in fc]),
                ),
                model,
            )
    return out


def parse_insights(
    rows: list[dict[str, Any]],
) -> tuple[dict[str, float | None], list[dict[str, Any]]]:
    overall: dict[str, float | None] = {"test": None, "control": None}
    out = []
    for r in rows:
        contributors = [str(c) for c in (r.get("contributors") or [])]
        if contributors in (["all"], ["ALL"], []):
            overall = {"test": _pct(r.get("metric_test")), "control": _pct(r.get("metric_control"))}
            continue
        out.append(
            {
                "contributors": contributors,
                "label": views.segment_label(contributors),
                "test": views.num(_pct(r.get("metric_test"))),
                "control": views.num(_pct(r.get("metric_control"))),
                "ratio": views.num(r.get("metric_test_over_metric_control")),
                "attribution": views.num(_pct(r.get("aumann_shapley_attribution"))),
                "support": views.num(r.get("apriori_support")),
            }
        )
    return overall, out[:TOP_CHANGES]


def _pct(x: Any) -> float | None:
    return None if x is None else 100.0 * float(x)


# The whole run.

STEPS = ("upload", "forecast", "anomalies", "arima", "changes", "summary", "ask")


def _made(
    runner: Runner,
    label: str,
    model: str,
    product: str,
    sql: str,
    kind: str = "query",
    **settings: Any,
) -> views.Made:
    m = views.Made(views.BIGQUERY, model, product, sql, settings)
    m.cost = runner.cost(label)
    m.settings |= {"location": runner.location, "dataset": runner.where.dataset}
    return m


def run(runner: Runner, steps: Sequence[str] = STEPS) -> list[Path]:
    """Every BigQuery view, saved as snapshots. Returns the files written."""
    w = runner.where
    written: list[Path] = []
    dry = runner.dry_only

    if "upload" in steps:
        print("upload")
        runner.upload()

    if "forecast" in steps:
        for sp in (span("hour"), span("day")):
            label = f"forecast-{sp.id}"
            print(label)
            sql = forecast_sql(w, sp)
            rows = runner.query(sql, label)
            if dry:
                continue
            bands = parse_forecast(rows, METRO_PRESETS)
            for p in METRO_PRESETS:
                made = _made(
                    runner,
                    label,
                    MODEL,
                    "BigQuery AI.FORECAST",
                    sql,
                    target_cols=[s.id for s in METRO_TARGETS],
                    past_covariate_cols=[s.id for s in METRO_PAST],
                    future_covariate_cols=list(FUTURE_COVARIATES),
                    horizon=sp.horizon,
                    context_window=CONTEXT,
                    confidence_level=CONFIDENCE,
                    cadence_min=sp.cadence_min,
                )
                written.append(
                    snapshot.save("bigquery", views.forecast_view(p, sp, bands[p.id], made))
                )

    if "anomalies" in steps:
        print("anomalies")
        sql = anomalies_sql(w)
        rows = runner.query(sql, "anomalies-metro")
        if not dry:
            table = sources.metro(WINDOW_CADENCE_MIN)

            def filled(t: np.ndarray) -> np.ndarray:
                return table.filled[np.searchsorted(table.t, t)]

            flags = parse_anomalies(
                rows, [p.id for p in METRO_PRESETS], [s.id for s in METRO_TARGETS], filled
            )
            for p in METRO_PRESETS:
                made = _made(
                    runner,
                    "anomalies-metro",
                    MODEL,
                    "BigQuery AI.DETECT_ANOMALIES",
                    sql,
                    anomaly_prob_threshold=ANOMALY_PROB,
                    context_window=CONTEXT,
                    cadence_min=WINDOW_CADENCE_MIN,
                    checked_hours=WINDOW_BEFORE_H + WINDOW_AFTER_H,
                    each_day_from_history_before_it=True,
                )
                written.append(
                    snapshot.save(
                        "bigquery",
                        views.anomalies_view("metro", p, METRO_TARGETS, flags[p.id], made),
                    )
                )
        for p in IMS_PRESETS if sources.ims_runs() else ():
            label = f"anomalies-{p.id.replace('/', '-')}"
            sql = ims_anomalies_sql(w, p.id, ims_starts(p.id))
            rows = runner.query(sql, label)
            if dry:
                continue
            flags = parse_anomalies(rows, [p.id], [s.id for s in IMS_SIGNALS], None)
            made = _made(
                runner,
                label,
                MODEL,
                "BigQuery AI.DETECT_ANOMALIES",
                sql,
                anomaly_prob_threshold=ANOMALY_PROB,
                context_window=CONTEXT,
                cadence_min=10,
            )
            written.append(
                snapshot.save(
                    "bigquery",
                    views.anomalies_view("ims", p, IMS_SIGNALS, flags[p.id], made, relative=True),
                )
            )

    if "arima" in steps:
        print("arima")
        create = arima_create_sql(w)
        runner.query(create, "arima-create", kind="model")
        explain = explain_sql(w)
        rows = runner.query(explain, "arima-explain")
        ev = runner.query(arima_evaluate_sql(w), "arima-evaluate")
        if not dry:
            parts = parse_explain(rows, ev, METRO_PRESETS)
            sql = create.strip() + ";\n\n" + explain.strip()
            sp = span("2w")
            for p in METRO_PRESETS:
                made = _made(
                    runner,
                    "arima-create",
                    "ARIMA_PLUS",
                    "BigQuery ML ARIMA_PLUS + ML.EXPLAIN_FORECAST",
                    sql,
                    "model",
                    horizon=sp.horizon,
                    confidence_level=CONFIDENCE,
                    data_frequency="HOURLY",
                    chosen={s.id: parts[p.id][s.id].model for s in METRO_TARGETS},
                )
                written.append(
                    snapshot.save("bigquery", views.breakdown_view(p, parts[p.id], made))
                )
                bands = {s.id: parts[p.id][s.id].forecast for s in METRO_TARGETS}
                written.append(snapshot.save("bigquery", views.forecast_view(p, sp, bands, made)))

    if "changes" in steps:
        control = preset("metro", CONTROL_PRESET)
        for p in METRO_PRESETS:
            if p.id == control.id:
                continue
            print(f"changes {p.id}")
            create = changes_create_sql(w, p)
            runner.query(create, f"changes-create-{p.id}", kind="model")
            ins = insights_sql(w, p)
            rows = runner.query(ins, f"changes-insights-{p.id}")
            if dry:
                continue
            overall, top = parse_insights(rows)
            made = _made(
                runner,
                f"changes-create-{p.id}",
                "Contribution analysis",
                "BigQuery ML contribution analysis + ML.GET_INSIGHTS",
                create.strip() + ";\n\n" + ins.strip(),
                "model",
                metric="SUM(loaded_min)/SUM(running_min)",
                dimensions=list(CHANGE_DIMENSIONS),
                min_apriori_support=MIN_SUPPORT,
            )
            written.append(
                snapshot.save(
                    "bigquery", views.changes_view(p, control, METRIC, overall, top, made)
                )
            )

    if "summary" in steps and not dry:
        print("summary")
        writer, name = summary.default_writer()
        for source, presets in (("metro", METRO_PRESETS), ("ims", IMS_PRESETS)):
            for p in presets:

                def get(view: str, source: str = source, pid: str = p.id) -> dict[str, Any] | None:
                    return snapshot.read("bigquery", source, pid, view)

                if get("anomalies") is None:
                    continue
                data = summary.summarise(source, p.id, get, views.BIGQUERY, writer, name)
                print(f"  {source}/{p.id}: {data['writer']}")
                written.append(snapshot.save("bigquery", data))

    if "ask" in steps and not dry:
        from . import ask

        print("ask (saved examples)")
        answers = []
        for q in ask.EXAMPLES:
            a = ask.ask(q, runner.where.project, runner.ledger)
            print(f"  {q[:60]}: {len(a['rows'])} rows, {a['made']['cost']}")
            answers.append(a)
        written.append(snapshot.save_examples(answers))
    return written
