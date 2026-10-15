"""Google's TimesFM, run inside BigQuery, as a when-to-fix forecaster.

TimesFM is a pretrained time-series model. It forecasts where this bearing's
log(peak) goes next, with an 80% band, and the time left is when that forecast
reaches the danger line: the same signal and the same line `TrendExtrapolation`
uses, so the two differ only in how the path is extended.

The upper edge of the band reaches the line first, so it gives the early end
(p10); the middle gives p50; the lower edge gives p90. Reading crossing times
off a band drawn step by step is an approximation, not the distribution of the
crossing time itself; the held-out test says how good it is.

It learns nothing from our bearings, so `fit` does nothing and leave-one-out
cannot leak. Like the learned model, it has weights, so it stays out of the
physics layer and never touches a belief.

It runs through BigQuery's `AI.FORECAST`. The series goes in as a query
parameter, so no table is created and nothing is stored. It needs Google
Cloud's login and the `timesfm` extra; without them the constructor raises and
the caller keeps the local forecasters. Nothing offline depends on it.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np

from .health import RunHealth
from .models import Forecast, danger_line

#: The models `AI.FORECAST` offers (BigQuery docs, AI.FORECAST reference, read
#: 13 Oct 2026). 2.5 is the default and generally available; 3.0 is in Preview.
MODELS = ("TimesFM 2.5", "TimesFM 3.0")

#: Steps forecast ahead. 1,024 is TimesFM 3.0's limit (2.5 allows 10,000), so
#: both models run the same setting. On XJTU-SY, at one-minute steps, it is 2.7
#: times the longest life left after any alarm (6.4 h, docs/FORECAST.md).
HORIZON = 1024

#: Past points the model sees: TimesFM 3.0's maximum, used for 2.5 too so the
#: only difference between them is the model. The oldest points drop first.
CONTEXT = 2048

#: The band's width: 0.8 makes its edges the 10th and 90th percentiles, the
#: range every forecaster here answers with.
CONFIDENCE = 0.8

#: Series per query. Chosen to keep one query's generated rows under about half
#: a million (CONTEXT x BATCH input, HORIZON x BATCH output).
BATCH = 256

#: Where the query runs: Cloud Run's region (docs/DEPLOY.md). AI.FORECAST
#: answered there on 13 Oct 2026. `BIGQUERY_LOCATION` overrides it.
DEFAULT_LOCATION = "asia-south1"

_EPOCH = "TIMESTAMP '2000-01-01'"


def build_sql(model: str, horizon: int = HORIZON, context: int = CONTEXT) -> str:
    """One query: every cut is its own series, and only the crossing steps come back.

    Snapshot k of the run is stamped k minutes after an arbitrary epoch, so the
    step count is exact whatever the rig's real interval; minutes are restored
    in Python. Settings are formatted in only after they are checked.
    """
    if model not in MODELS:
        raise ValueError(f"model is one of {MODELS}")
    if not 1 <= int(horizon) <= 1024:
        raise ValueError("horizon is 1..1024 (TimesFM 3.0's limit)")
    if int(context) not in (64, 128, 256, 512, 1024, 2048):
        raise ValueError("context is a power of two from 64 to 2048")
    return f"""
WITH s AS (
  SELECT off AS i, v FROM UNNEST(@v) AS v WITH OFFSET AS off
),
series AS (
  SELECT cut, TIMESTAMP_ADD({_EPOCH}, INTERVAL s.i MINUTE) AS ts, s.v
  FROM UNNEST(@cuts) AS cut
  JOIN s ON s.i <= cut AND s.i > cut - {int(context)}
),
f AS (
  SELECT * FROM AI.FORECAST(
    (SELECT cut, ts, v FROM series),
    data_col => 'v', timestamp_col => 'ts', id_cols => ['cut'],
    model => '{model}', horizon => {int(horizon)},
    confidence_level => {CONFIDENCE}, context_window => {int(context)})
)
SELECT
  cut,
  MIN(IF(prediction_interval_upper_bound >= @line, k, NULL)) AS k_early,
  MIN(IF(forecast_value >= @line, k, NULL)) AS k_mid,
  MIN(IF(prediction_interval_lower_bound >= @line, k, NULL)) AS k_late,
  MAX(ai_forecast_status) AS status
FROM (
  SELECT *, TIMESTAMP_DIFF(forecast_timestamp, {_EPOCH}, MINUTE) - cut AS k FROM f
)
GROUP BY cut
"""


#: What a query runner gets and returns: (sql, log-peak series, cuts, log line)
#: -> {cut: (k_early, k_mid, k_late, status)}. A step is None when that edge
#: never reaches the line within the horizon.
Steps = tuple[int | None, int | None, int | None, str]
QueryFn = Callable[[str, list[float], list[int], float], dict[int, Steps]]


def bigquery_runner(project: str | None = None, location: str | None = None) -> QueryFn:
    """Run the query on BigQuery with Google Cloud's login (ADC)."""
    try:
        from google.cloud import bigquery
    except ImportError as e:  # the optional extra is missing
        raise RuntimeError("TimesFM needs the timesfm extra: uv pip install -e '.[timesfm]'") from e
    client = bigquery.Client(
        project=project or os.environ.get("GOOGLE_CLOUD_PROJECT") or None,
        location=location or os.environ.get("BIGQUERY_LOCATION", DEFAULT_LOCATION),
    )

    def run(sql: str, v: list[float], cuts: list[int], line: float) -> dict[int, Steps]:
        cfg = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ArrayQueryParameter("v", "FLOAT64", v),
                bigquery.ArrayQueryParameter("cuts", "INT64", cuts),
                bigquery.ScalarQueryParameter("line", "FLOAT64", line),
            ]
        )
        rows = client.query(sql, job_config=cfg).result()
        return {
            int(r["cut"]): (r["k_early"], r["k_mid"], r["k_late"], r["status"] or "") for r in rows
        }

    return run


#: What TimesFM is shown. "peak" is log(peak) as recorded. "ratchet" is its
#: running maximum: damage does not heal (the same rule as percent.py), and on
#: the recorded peak TimesFM forecasts a jump falling back, as if it were noise.
#: "ratchet" was added after seeing that on one test bearing (Bearing2_4).
SIGNALS = ("peak", "ratchet")


def series(h: RunHealth, n: int, signal: str) -> list[float]:
    """The first n snapshots as TimesFM sees them, in log units."""
    y = np.log(np.maximum(h.peak[:n], 1e-12))
    if signal == "ratchet":
        y = np.maximum.accumulate(y)
    elif signal != "peak":
        raise ValueError(f"signal is one of {SIGNALS}")
    return y.tolist()


@dataclass
class TimesFMForecaster:
    """Time left from TimesFM's forecast of log(peak). See the module docstring."""

    model: str = MODELS[0]
    signal: str = SIGNALS[0]
    query: QueryFn | None = None
    horizon: int = HORIZON
    context: int = CONTEXT

    def __post_init__(self) -> None:
        if self.signal not in SIGNALS:
            raise ValueError(f"signal is one of {SIGNALS}")
        self.sql = build_sql(self.model, self.horizon, self.context)
        self.name = "timesfm-" + self.model.split()[-1]
        if self.signal != "peak":
            self.name += "-" + self.signal
        if self.query is None:
            self.query = bigquery_runner()

    def fit(self, runs: Sequence[RunHealth]) -> None:  # pretrained: nothing to learn
        return None

    def predict_many(self, h: RunHealth, indices: Sequence[int], onset: int) -> list[Forecast]:
        indices = list(indices)
        line = danger_line(h)
        step = float(np.median(np.diff(h.t))) if len(h) > 1 else 1.0
        todo = [i for i in indices if h.peak[i] < line]
        answers: dict[int, Steps] = {}
        if todo:
            # A prefix of the ratchet is the ratchet of the prefix, so one
            # series serves every cut without looking past any of them.
            v = series(h, max(todo) + 1, self.signal)
            for b in range(0, len(todo), BATCH):
                cuts = todo[b : b + BATCH]
                assert self.query is not None
                answers.update(self.query(self.sql, v, cuts, float(np.log(line))))
        out = []
        for i in indices:
            if h.peak[i] >= line:
                out.append(Forecast(0.0, 0.0, 0.0, self.name, "already over the danger line"))
                continue
            k_early, k_mid, k_late, status = answers[i]
            if status:
                raise RuntimeError(f"AI.FORECAST at snapshot {i} of {h.run_id}: {status}")
            # Same cap and wording as TrendExtrapolation: a crossing the forecast
            # does not reach becomes "not within the time it has already run".
            cap = max(float(h.t[i] - h.t[0]), 1.0)

            def minutes(k: int | None, cap: float = cap) -> float:
                return min(k * step, cap) if k is not None else cap

            p10, p50, p90 = sorted((minutes(k_early), minutes(k_mid), minutes(k_late)))
            note = "" if k_late is not None else "the band's late edge stays under the line"
            out.append(Forecast(p10, p50, p90, self.name, note))
        return out
