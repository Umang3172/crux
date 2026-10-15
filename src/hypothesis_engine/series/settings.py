"""What the Trends tab looks at, from when, how far ahead, and what it may spend.

Each value says why it is what it is; docs/SERIES.md has a row for each. The
"as of" moments were fixed before any model ran and were not moved after
seeing a result: a moment picked because the chart looked good would make every
picture here an advert.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..data.root import DATA_ROOT

SERIES_DIR = DATA_ROOT / "series"
SNAPSHOT_DIR = SERIES_DIR / "snapshots"
LEDGER_FILE = SERIES_DIR / "ledger.json"


@dataclass(frozen=True)
class Signal:
    id: str  # the column in the prepared tables and in BigQuery
    name: str
    unit: str


@dataclass(frozen=True)
class Preset:
    id: str
    label: str
    as_of: str  # ISO minute in the dataset's own clock; no time zone is recorded
    note: str


@dataclass(frozen=True)
class Span:
    id: str
    label: str
    cadence_min: int
    horizon: int  # steps ahead
    shown: int  # steps of history drawn before "as of"
    model: str
    product: str


# The metro train's air compressor (MetroPT-3, UCI dataset 791, CC BY 4.0).

#: What is forecast. The loaded share is what a leak changes first: the
#: compressor runs loaded more often to hold the pressure (forecast/metropt.py).
#: Motor current doubles as the energy reading; oil temperature follows load.
METRO_TARGETS = (
    Signal("loaded", "Loaded share", "%"),
    Signal("motor_current", "Motor current", "A"),
    Signal("oil_temp", "Oil temperature", "°C"),
)

#: Known only up to "as of": the reservoir pressure the compressor works to
#: hold. TP3, the panel pressure, tracks it closely and is left out: AI.FORECAST
#: takes at most 6 targets and helpers together in Preview ("cannot exceed 6",
#: BigQuery's answer on 14 Oct 2026; more needs an allowlist).
METRO_PAST = (Signal("reservoirs", "Reservoir pressure", "bar"),)

#: Known ahead for any moment: the time of day, as a point on a circle so 23:59
#: sits next to 00:00. The compressor follows a train timetable, so this is a
#: true future helper. The weekend flag was dropped for the 6-column limit; the
#: 21-day context still holds three weekends.
FUTURE_COVARIATES = ("hour_sin", "hour_cos")

#: Every column the prepared metro tables carry. `towers` is which of the two
#: air-drying towers is working (UCI variable description).
METRO_COLUMNS = ("loaded", "motor_current", "oil_temp", "tp3", "reservoirs", "towers")

#: Each leak moment is a replay of the day the leak happened, seen from a few
#: hours before its report: the label names the leak, not a warning ahead of it.
#: The times themselves are unchanged since they were fixed.
METRO_PRESETS = (
    Preset("normal", "Normal week", "2020-03-10T08:00", "A week in March with no reported failure"),
    Preset("leak1", "Leak 1", "2020-04-17T08:00", "Seen from 16 h before the report"),
    Preset("leak2", "Leak 2", "2020-05-29T08:00", "Seen from 15.5 h before the report"),
    Preset("leak3", "Leak 3", "2020-06-05T06:00", "Seen from 4 h before the report"),
    Preset("leak4", "Leak 4", "2020-07-15T08:00", "Seen from 6.5 h before the report"),
)

#: What the leak moments can and cannot show, for the tab. Measured on the
#: one-minute table (docs/SERIES.md, "Does it warn early?"): on the ten days
#: before each leak the compressor ran loaded for about as much of its running
#: time as in the normal week, apart from single busy days that the normal
#: months have too; each leak shows from around the hour it was reported.
METRO_NOTE = (
    "Each leak here is a replay of the day it happened. In this record a leak shows in the "
    "readings around the time it is reported, not days before: the days before it look like "
    "a normal week."
)

#: The control week for "what changed": the normal preset's window.
CONTROL_PRESET = "normal"

SPANS = (
    # TimesFM 3.0 allows a horizon of 1..1,024 and a context of up to 2,048
    # points (BigQuery AI.FORECAST reference, read 14 Oct 2026). One-minute
    # means: an hour ahead from the last 34 hours.
    Span("hour", "Next hour", 1, 60, 360, "TimesFM 3.0", "BigQuery AI.FORECAST"),
    # Fifteen-minute means: a day ahead from the last 21 days, three weekly
    # timetables.
    Span("day", "Next day", 15, 96, 288, "TimesFM 3.0", "BigQuery AI.FORECAST"),
    # Hourly means: two weeks ahead from all history. Past TimesFM 3.0's
    # context, so ARIMA_PLUS, which also splits the series into its parts.
    Span("2w", "Next 2 weeks", 60, 336, 504, "ARIMA_PLUS", "BigQuery ML ARIMA_PLUS"),
)

#: TimesFM 3.0's largest context, used whenever that much history exists.
CONTEXT = 2048

#: The band drawn around a forecast: 0.8 makes its edges the 10th and 90th
#: percentiles, the range the rest of Crux answers with.
CONFIDENCE = 0.8

#: The week the anomaly check and "what changed" look at: it ends a day after
#: "as of", so it covers the day the next-day forecast is for (a replay of what
#: really happened), and its first six days show how often normal days are flagged.
WINDOW_BEFORE_H = 6 * 24
WINDOW_AFTER_H = 24
WINDOW_CADENCE_MIN = 15

#: The anomaly check holds each day to what TimesFM expected from the history
#: before that day, as a daily job would (series/bigquery.py says why).
CHUNK_H = 24

#: Google's default for AI.DETECT_ANOMALIES: a point is flagged when the model
#: puts it outside the band with this probability.
ANOMALY_PROB = 0.95

#: The offline stand-in's band for anomalies: the median of the same time of
#: day over the previous `OFFLINE_DAYS` days, plus or minus k robust standard
#: deviations. 3 is the usual "three sigma"; it is not tuned on the leaks.
OFFLINE_K = 3.0
OFFLINE_DAYS = 14

#: "What changed" measures the loaded share while the motor runs: the share of
#: running minutes spent loaded. A leak pushes it up (the compressor must work
#: harder to hold pressure), and unlike total current it does not fall when
#: fewer trains run. A minute counts as running when the motor draws at least
#: 1 A; off it draws about 0.04 A, loaded or idle 3.7 to 5.6 A (medians over the
#: whole record). The day is cut in four six-hour bands so a band holds whole
#: shifts; the dryer tower is which of the two drying towers was working.
CHANGE_DIMENSIONS = ("hour_band", "day_type", "dryer_tower")
OFF_BELOW_A = 1.0

#: A reading outside the band counts only when the motor ran for at least this
#: share of its step's minutes. A step mostly off reads near 0% loaded and 0 A,
#: which a band learnt mostly on running hours flags: that says the train was
#: parked, not how the compressor works. In the week of leak 2, 131 of the 194
#: loaded-share readings TimesFM flagged fell while the motor was off (14 Oct
#: 2026). Half is the plain cut between mostly running and mostly off.
RUNNING_SHARE = 0.5
#: Google's default: a segment must hold at least a tenth of either week.
MIN_SUPPORT = 0.1
TOP_CHANGES = 5


# The NASA IMS bearing rig: run-to-failure tests, a snapshot every 10 minutes.

IMS_SIGNALS = (
    Signal("rms", "Vibration RMS", "g"),
    Signal("kurtosis", "Kurtosis", ""),
)

#: The bearings that failed, with the end of the run as "as of": the check
#: looks at the run's last days, the time our own watcher alarms in.
IMS_PRESETS = (
    Preset("ims/test1/bearing3", "Test 1, bearing 3", "end", "Inner race failure"),
    Preset("ims/test1/bearing4", "Test 1, bearing 4", "end", "Roller failure"),
    Preset("ims/test2/bearing1", "Test 2, bearing 1", "end", "Outer race failure"),
    Preset("ims/test3/bearing3", "Test 3, bearing 3", "end", "Outer race failure"),
)

IMS_CADENCE_MIN = 10
#: The last week of a run is checked; a run keeps at least this much history
#: before it, so the model has a normal to compare with.
IMS_CHECK_POINTS = 7 * 24 * 6
IMS_MIN_HISTORY = 256


# Google Cloud.

DATASET = "crux_ts"
#: Cloud Run's region (docs/DEPLOY.md). AI.FORECAST answered there on 13 Oct 2026.
DEFAULT_LOCATION = "asia-south1"

#: Spend guard. A job that would bill more than this fails without charge.
MAX_BYTES_BILLED = 1 << 30
#: The whole run stops before a job that would take the ledger past this.
BUDGET_USD = 5.0
#: On the high side, because Google's pricing page did not render on 14 Oct
#: 2026 and these come from secondary sources: queries and TimesFM at $7.50 per
#: TiB, model creation (ARIMA_PLUS, contribution analysis) at $375 per TiB.
QUERY_USD_PER_TIB = 7.5
MODEL_USD_PER_TIB = 375.0


def preset(source: str, preset_id: str) -> Preset:
    for p in presets(source):
        if p.id == preset_id:
            return p
    raise KeyError(preset_id)


def presets(source: str) -> tuple[Preset, ...]:
    if source == "metro":
        return METRO_PRESETS
    if source == "ims":
        return IMS_PRESETS
    raise KeyError(source)


def span(span_id: str) -> Span:
    for s in SPANS:
        if s.id == span_id:
            return s
    raise KeyError(span_id)
