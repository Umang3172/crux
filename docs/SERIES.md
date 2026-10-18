# Trends: Google's time-series tools on sensor history

The Trends tab shows what a machine's sensors will do next and what looks
different now. Google's own tools compute every number in it, inside BigQuery,
and Gemini sums each moment up in plain words. It describes signals and never
diagnoses: nothing here imports the investigation or the physics, and nothing
here moves a belief.

Code: `src/hypothesis_engine/series/` (settings, data, views, offline
stand-ins, the BigQuery run, the summary, Ask the data) and
`src/hypothesis_engine/api/series.py` (the `/series` routes). UI:
`web/src/pages/trends/` and `web/src/api/series.ts`, which talk to the server
only over HTTP.

The tab is four screens, one at a time, each sized to fit a laptop without
scrolling: Overview (Gemini's three sentences and what changed against the
normal week), Forecast (one signal, one span), Unusual readings (one signal)
and Ask the data. Every number for a leak is shown beside the normal week's.
The tab shows the compressor only: the bearing rig's views are still served,
but its screen could only count readings outside a band, and on bearings
TimesFM does worse than the trained time-left model (below). Each screen names the product that made it and opens the SQL
in a dialog. A live question draws the agent's steps as they stream in
(`askPipeline.ts`, `AskFlow.tsx`); the diagram's arrow into the diagnosis is
barred, because nothing said here reaches an investigation. The parts of a
signal (`/breakdown`) are served but not drawn: the two-week forecast they come
with is the Forecast screen's third span.

## Which Google product does which job

| Job | Product | Why this one |
|---|---|---|
| Next hour and next day, three signals at once | TimesFM 3.0 through BigQuery `AI.FORECAST` (Preview) | No training. Takes past and future helpers. One query answers every moment (`id_cols`) |
| Readings outside the expected band | TimesFM 3.0 through `AI.DETECT_ANOMALIES` | One query, one series per moment, signal and day |
| Next two weeks, and what a signal is made of | BigQuery ML `ARIMA_PLUS` with `ML.EXPLAIN_FORECAST` | Past TimesFM 3.0's 2,048-point context. Splits a series into trend, daily and weekly pattern, spikes and dips, step changes and residual |
| What changed against a normal week | BigQuery ML contribution analysis with `ML.GET_INSIGHTS` | Ranks the segments of time behind a change |
| A summary in plain words | Gemini on Vertex AI | Words only: a reply stating a number that is not among the facts is dropped. Three sentences: what is different, the evidence beside the normal week's number, and when a person could look (the part of the week that changed most), never a cause. For the normal week, that it is the week the others are compared with |
| How far to trust each model | BigQuery `AI.EVALUATE` beside our own scoring | Scores the same TimesFM forecasts again, as a check on the benchmark below |
| Ask the data | Conversational Analytics API (Gemini data agent over the BigQuery tables) | A question in plain words comes back as text, the SQL it wrote, the rows and a chart spec |
| Storage | BigQuery dataset `crux_ts` in `asia-south1` | One home for the sensor history the models read |

Bearing time left is not here. On held-out bearings TimesFM forecasts a growing
fault levelling off, so its crossing of the danger line comes too late or never
(FORECAST.md). Time left stays on the trained model.

## The data

- **Metro train air compressor**: MetroPT-3 (UCI dataset 791, CC BY 4.0), 15
  signals every 10 seconds from 1 Feb to 1 Sep 2020, with four air leaks the
  operator reported (`forecast/metropt.py`). `scripts/series.py prepare` folds
  the 218 MB file once into one-minute, fifteen-minute and hourly means. The
  clock has holes (the longest two days, from 25 Apr 2020): a missing step takes
  the same step a day earlier and is marked `filled`, because TimesFM needs a
  regular grid. Charts draw filled steps as gaps; ARIMA_PLUS and "what changed"
  leave them out.
- **Bearing test rig**: NASA IMS run-to-failure tests, from the health table
  `scripts/forecast.py table` builds. In BigQuery a run's snapshots sit on a
  regular 10-minute clock from 2000-01-01; the axis reads hours of the run.

## Moments and spans

The "as of" moments were fixed before any model ran, and not moved after:

| Moment | As of | Before the reported leak |
|---|---|---|
| Normal week | 10 Mar 2020 08:00 | none reported; the control week |
| Leak 1 | 17 Apr 2020 08:00 | 16 h |
| Leak 2 | 29 May 2020 08:00 | 15.5 h |
| Leak 3 | 5 Jun 2020 06:00 | 4 h |
| Leak 4 | 15 Jul 2020 08:00 | 6.5 h |

A leak moment is a replay of the day the leak happened, seen from a few hours
before its report: the next day holds the leak. It is not a warning ahead of
it, and the record gives no such warning (below). The moments were first
labelled "Before leak N"; they were renamed on 14 Oct 2026 so the label does
not promise one. The times are unchanged.

| Span | Step | Context | Ahead | Model |
|---|---|---|---|---|
| Next hour | 1 min | 2,048 steps (34 h) | 60 | TimesFM 3.0 |
| Next day | 15 min | 2,048 steps (21 days) | 96 | TimesFM 3.0 |
| Next 2 weeks | 1 h | all history | 336 | ARIMA_PLUS |

The two-week span is computed, because its ARIMA_PLUS model also gives the
parts the summary is written from, but since 17 Oct 2026 it is not offered on
screen (`settings.OFFERED_SPANS`): no benchmark has scored it, and a leak
shows within hours of its report.

TimesFM 3.0 forecasts loaded share, motor current and oil temperature
together. Reservoir pressure is a past helper (known only up to "as of"); the
time of day, as a point on a circle, is a future helper. AI.FORECAST takes at
most six targets and helpers together in Preview, so the panel pressure (which
tracks the reservoir) and a weekend flag were left out. The step at "as of" is
always forecast, never history.

The anomaly check and "what changed" look at a week that ends a day after "as
of": its last day is the day the next-day forecast covers, as a replay of what
really happened. Each day of that week is held to what TimesFM expected from
the history before that day began, as a daily job would run. Checked as one
stretch, the end of the week sat a week ahead of its history and its band grew
wide enough to hide the leak.

A reading outside the band counts only while the motor ran for at least half
its step (`RUNNING_SHARE`). A step the train spent parked reads near 0% loaded
and 0 A, which the band, learnt mostly on running hours, flags: in the week of
leak 2, 301 of the 471 readings TimesFM flagged were parked steps. The model's
own flags are kept in the view (`flagged`); the ones that count are `counted`,
split at "as of", and a leak week is served with the normal week's counts
beside it (`normal`). The chart draws the parked ones grey.

"What changed" measures the loaded share while the motor runs: the share of
running minutes spent loaded. A leak pushes it up, and unlike total current it
does not fall when fewer trains run (spring 2020 had fewer). The week is split
by six-hour band, weekday or weekend, and drying tower.

## Results (BigQuery run of 14 Oct 2026)

| Moment | Next day, loaded share: TimesFM expected / really | Outside the band while running: 6 days before "as of" / the day after | Outside while parked, not counted | Loaded while running: that week / normal week |
|---|---|---|---|---|
| Normal week | 12.4% / 20.7% | 74 / 32 | 57 | control |
| Leak 1 | 8.1% / 32.1% | 158 / 89 | 71 | 51.8% / 28.7% |
| Leak 2 | 15.1% / 36.5% | 88 / 82 | 301 | 35.7% / 28.7% |
| Leak 3 | 14.3% / 86.0% | 69 / 243 | 24 | 45.7% / 28.7% |
| Leak 4 | 38.0% / 39.7% | 74 / 77 | 101 | 32.4% / 28.7% |

The day after "as of" holds each leak, and there every leak stands out from the
normal week (77 to 243 readings against 32). The six days before do not, apart
from leak 1 (158 against 74). The next-day forecast also misses on a normal day
(12.4% expected, 20.7% real), so its miss on a leak day reads true only beside
that. Read these as pictures of four leaks, not as a tested detector: four
events on one machine, no threshold tuned. The watcher's own evaluation on this
machine is in FORECAST.md. The counts were taken again from the saved views
with `scripts/series.py recount` (no model ran); the 14 Oct 2026 run counted
every flag and gave 163 for the normal week and 318, 471, 336 and 252 for the
leaks.

### Does it warn early?

No: in this record a leak shows around the time it is reported.
`scripts/series.py early` reads the share of running minutes spent loaded
straight from the one-minute table:

| | Ten days before the reported day | Reported day | Hours before the report |
|---|---|---|---|
| Normal week (7 days to "as of") | 20 to 32% | | |
| Leak 1 (18 Apr 00:00) | 19 to 27%, except 12 Apr: 84% | 100% | parked; 100% from the reported hour |
| Leak 2 (29 May 23:30) | 24 to 38%, except 20 May: 98% | 29%; the next day 54% | 17 to 32%; 100% from 23:00 |
| Leak 3 (5 Jun 10:00) | 23 to 31%, except 30 May (leak 2): 54% | 83% | 19 to 36%, 50% at 09:00; 100% from 10:00 |
| Leak 4 (15 Jul 14:30) | 24 to 26%, except 8 Jul: 44% | 50% | climbing from 33% at 02:00 to 60% at 13:00; 85% at 14:00 |

Single busy days come before leaks 1 and 2, and the normal months have one too
(29 Mar, over 80%, among 59 days of February and March), so they are not a
warning on their own. Leak 4 is the only one that builds over hours. A plain
rule, loaded for 80% of running time two hours in a row, catches all four 0.5
to 2 hours after their reports and fires 4 times in February and March with no
leak (14 Oct 2026, a check outside the code). What the tab can honestly offer
is to notice a leak within hours, against a normal week, not to foresee it.

## Benchmark: every day of the record, not five moments

The five moments are pictures. The benchmark scores the same models on every
day the record allows, so the tab can say how far to trust them
(`series/bench.py`, `scripts/series.py bench`). Its rules were written here on
15 Oct 2026, before any of it ran, and are not changed after seeing a result.

**Next day.** The loaded share in fifteen-minute steps, as the Next day span
forecasts it.

- From 08:00 on every day that has 2,048 steps before it and its next 96 steps
  in the record. A step whose clock was filled is not scored.
- Methods:
  1. TimesFM 3.0 as the tab runs it (`forecast_sql`: three targets, reservoir
     pressure and the clock as helpers, context 2,048);
  2. TimesFM 3.0 on the loaded share alone, context 2,048;
  3. TimesFM 2.5 on the loaded share alone, with up to 15,360 steps (160 days)
     behind it and the context BigQuery picks;
  4. the same time yesterday, with a band from that rule's own errors over the
     2,048 steps before (`offline.seasonal_band`, the stand-in the tab already
     uses).
- Scored as the tab draws them, within 0 to 100%:
  - the typical miss: the mean absolute error, in points of loaded share;
  - the miss against yesterday's: its summed absolute error over the summed
    error of method 4 on the same steps, so below 1 beats it;
  - how often the truth fell inside the 80% band.
- Days whose next 24 hours overlap a reported leak are scored apart from the
  rest. A day that any method could not forecast is left out for every method.
- Google's own `AI.EVALUATE` scores methods 2 and 3 again on the same days, as
  a check on ours.

**Leaks.** Four detectors on the loaded share, from 1 Feb to 1 Sep 2020:

1. Crux's watcher, its own last 28 days as normal (`forecast/metropt.py`,
   unchanged);
2. TimesFM 3.0's anomaly check as the tab runs it: each calendar day's 96 steps
   held to the 2,048 steps before the day began, Google's default threshold;
3. the offline band (median of the same time of day over 14 days, plus or minus
   3 robust standard deviations), a day at a time the same way;
4. a plain rule: an hour in which the motor ran at least half its minutes and
   ran loaded for at least 80% of them.

For detectors 2 and 3, a clock hour is flagged when any of its steps falls
outside the band while the motor ran most of it, and an alarm fires on the
third flagged hour in a row: the watcher's own onset rule (`onset.CONSECUTIVE`).
Detector 4 fires on its second flagged hour in a row, as it was first checked on
14 Oct 2026.

Every detector is scored by the watcher's rules (`metropt.score`):

- a leak is caught by an alarm that fires from 24 hours before its reported
  start to its end;
- the warning is the time from that alarm to the reported start;
- a false alarm is one that fires after 1 Mar 2020 and not within 24 hours of
  any leak, counted per month.

### Results (BigQuery run of 15 Oct 2026)

191 days, 22 Feb to 30 Aug 2020; no day was left out. Six jobs, $0.0004 by
the ledger. `scripts/series.py bench` reproduces it; the board is served at
`GET /series/metro/bench` and drawn on the Track record page.

| Next day, loaded share | 184 ordinary days: typical miss / against yesterday / range held | 7 leak days: typical miss / range held |
|---|---|---|
| TimesFM 3.0 as the tab runs it, with helpers | 9.3 points / 0.61 / 75% | 31.5 / 55% |
| TimesFM 3.0, loaded share alone | 9.7 / 0.64 / 72% | 31.7 / 60% |
| TimesFM 2.5, up to 160 days behind it | 9.4 / 0.63 / 80% | 35.4 / 53% |
| Same time yesterday | 15.1 / 1.00 / 80% | 46.1 / 44% |

TimesFM 3.0 with its helpers misses 39% less than repeating yesterday; the
helpers take a little off the miss (9.3 against 9.7 alone). Its 80% range is a
little narrow (75%); TimesFM 2.5 with the longer memory holds 80%. On a day
holding a leak every method misses by 31 to 46 points: none expects a leak.
Google's `AI.EVALUATE` on all 191 days gave 10.5 points for TimesFM 3.0 alone
and 10.9 for TimesFM 2.5; ours over the same days is 10.6 and 10.5. Ours draws
the forecast within 0 to 100% and leaves filled steps out; `AI.EVALUATE` does
neither, and averages per day.

| Leaks | Caught | Each leak, alarm against the reported start | False alarms a month |
|---|---|---|---|
| Crux's watcher, its own last 28 days as normal | 4 of 4 | 6 h after, 5 h after, 6 h after, 5 h before | 2.6 |
| TimesFM 3.0 anomaly check, a day at a time | 3 of 4 | 2 h after, missed, 1 h after, 7 h before | 5.6 |
| Same time of day over 14 days, 3 spreads | 4 of 4 | 2 h after, 2 h after, 1 h before, 13 h before | 9.6 |
| Loaded 80% of running time, two hours in a row | 4 of 4 | 1 h after each | 2.6 |

The watcher's row matches its own run (`scripts/forecast.py metro`), which
checks the shared scorer. TimesFM's check missed leak 2 and raised twice the
false alarms of the watcher, so the tab shows its flags as readings to look
at, not as alarms. No detector warns a day or more ahead, as the section above
found.

## Offline stand-ins

Without Google Cloud the same views come from simple rules, labelled "Offline
stand-in, not Google" in the UI and `engine: "offline stand-in"` in the JSON
(`series/offline.py`): the same time a day earlier for a forecast, the median
of the same time of day over two weeks for the band, a moving average and
average day and week for the parts, a mean per segment for what changed. Each
looks only at data before the moment it answers for (tests/test_series.py). CI
never needs a key.

## Serving

Views are saved as JSON under `data/series/snapshots/<engine>/<source>/<moment>/`.
A request is answered from a BigQuery snapshot, else an offline one, else the
stand-in computed then and saved. A page view never calls Google. The one
exception is a live question (`POST /series/ask`, or `/series/ask/live` for the
same answer as a stream of its steps), which exists only when `CRUX_SERIES_ASK`
is set, caps each of the agent's queries at 100 MB and answers at most 60
questions an hour. Saved answers to three example questions show on any server.

The agent streams progress notes as it works; Google's wording on 14 Oct 2026
was "Analyzing context", "Context retrieved", "Running a query" (with the SQL)
and "Query execution completed", then the answer, rows and chart arrive
together. `series/ask.read` folds them into five phases (tables, sql, query,
answer, chart), each opened and closed once; if the wording changes, the data
messages still close every phase, only later.

| Route | Returns |
|---|---|
| `GET /series/catalog` | Sources, signals, moments, spans, leak windows, and which engine serves each view |
| `GET /series/{source}/forecast?preset&span` | History, forecast band, what really happened, the exact SQL |
| `GET /series/{source}/anomalies?preset` | Readings, the expected band, the points outside it |
| `GET /series/{source}/breakdown?preset` | The parts of each signal, two weeks ahead, the model ARIMA_PLUS chose |
| `GET /series/{source}/changes?preset` | The segments that changed most against the normal week |
| `GET /series/{source}/summary?preset` | Three sentences, and the facts they were written from |
| `GET /series/ask/examples`, `POST /series/ask` | Saved answers; a live question when switched on |
| `POST /series/ask/live` | The same live question as one JSON line per phase, then the answer |
| `GET /series/{source}/bench` | Every day of the record scored (compressor only): the next-day forecasts and the leak detectors |

## Running it

```bash
uv sync --extra dev --extra series
uv run python scripts/series.py prepare                                # once, needs data/metropt/
uv run python scripts/series.py snapshot --engine offline              # no network
uv run python scripts/series.py snapshot --engine bigquery --dry-run   # what each job may cost
uv run python scripts/series.py snapshot --engine bigquery             # the Google run
uv run python scripts/series.py spent                                  # the ledger
uv run python scripts/series.py recount                                # count saved views again, no network
uv run python scripts/series.py early                                  # loaded share before each leak
uv run python scripts/series.py bench --engine bigquery --dry-run      # what the benchmark may cost
uv run python scripts/series.py bench --engine bigquery                # every day of the record scored
```

The Google run reads `GOOGLE_CLOUD_PROJECT` and `BIGQUERY_LOCATION` (default
`asia-south1`), and Gemini's usual settings (`GOOGLE_GENAI_USE_ENTERPRISE`,
`GOOGLE_CLOUD_LOCATION`). Ask the data needs the Gemini Data Analytics and
Gemini for Google Cloud APIs enabled on the project.

## Cost guard

Every job is dry-run first; its estimate goes against a ledger
(`data/series/ledger.json`) and the run stops before any job that would take it
past $5. Every job carries `maximum_bytes_billed` of 1 GiB, so one over it
fails without charge. Rates are taken on the high side because Google's pricing
page did not render when this was written: $7.50 per TiB for queries and
TimesFM, $375 per TiB for model creation, ARIMA_PLUS counted as 42 candidate
models, and BigQuery's 10 MB minimum per table. The whole run of 14 Oct 2026,
with retries and one live question, came to $0.024 at those rates. Gemini's
summaries are outside the ledger: nine short calls per run. From 1 Dec 2026 TimesFM 3.0 is
billed by tokens instead of bytes (AI.FORECAST reference).

## Settings and where they come from

| Setting | Value | Source or reason |
|---|---|---|
| TimesFM 3.0 limits | horizon 1 to 1,024; context n x 32 up to 2,048 | BigQuery AI.FORECAST reference, read 14 Oct 2026 |
| Targets plus helpers | at most 6 | BigQuery's error on 14 Oct 2026; more needs an allowlist |
| Band | 80% (p10 to p90) | the range the rest of Crux answers with |
| `anomaly_prob_threshold` | 0.95 | Google's default |
| `AI.DETECT_ANOMALIES` evaluates | the latest 1,024 points | AI.DETECT_ANOMALIES reference; bearings run one query each |
| Check window | 6 days before "as of" to 1 day after, a day at a time | covers the next-day forecast's day; see above |
| Running | motor at least 1 A | off draws about 0.04 A, idle 3.7 A, loaded 5.6 A (medians over the record) |
| A reading counts | the motor ran at least half the step's minutes | a parked step reads near 0, which the band flags; half is the plain cut between mostly running and mostly off |
| Contribution analysis support | 0.1 | Google's default |
| Stand-in band | median of the same time of day over 14 days, plus or minus 3 robust standard deviations, spread floored at 2% of the usual range | chosen before any run; a floor, not a detector |
| Ask the data | 100 MB per query, 60 questions an hour | 100 MB is the example in Google's cost guide |
| Forecasts drawn within | loaded share 0 to 100%, motor current from 0 A | physical limits the models do not know |
