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
and Ask the data. Each screen names the product that made it and opens the SQL
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
| A summary in plain words | Gemini on Vertex AI | Words only: a reply stating a number that is not among the facts is dropped |
| Ask the data | Conversational Analytics API (Gemini data agent over the BigQuery tables) | A question in plain words comes back as text, the SQL it wrote, the rows and a chart spec |
| Storage | BigQuery dataset `crux_ts` in `asia-south1` | One home for the sensor history the models read |

Bearing time left is not here. On held-out bearings TimesFM forecasts a growing
fault levelling off, so its crossing of the danger line comes too late or never
(FORECAST.md). Time left stays on the trained model; the tab says so.

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
| Before leak 1 | 17 Apr 2020 08:00 | 16 h |
| Before leak 2 | 29 May 2020 08:00 | 15.5 h |
| Before leak 3 | 5 Jun 2020 06:00 | 4 h |
| Before leak 4 | 15 Jul 2020 08:00 | 6.5 h |

| Span | Step | Context | Ahead | Model |
|---|---|---|---|---|
| Next hour | 1 min | 2,048 steps (34 h) | 60 | TimesFM 3.0 |
| Next day | 15 min | 2,048 steps (21 days) | 96 | TimesFM 3.0 |
| Next 2 weeks | 1 h | all history | 336 | ARIMA_PLUS |

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

"What changed" measures the loaded share while the motor runs: the share of
running minutes spent loaded. A leak pushes it up, and unlike total current it
does not fall when fewer trains run (spring 2020 had fewer). The week is split
by six-hour band, weekday or weekend, and drying tower.

## Results (BigQuery run of 14 Oct 2026)

| Moment | Next day, loaded share: TimesFM expected / really | Readings outside the band: the week / the day after "as of" | Loaded while running: that week / normal week |
|---|---|---|---|
| Normal week | 12.4% / 20.7% | 163 / 32 | control |
| Before leak 1 | 8.1% / 32.1% | 318 / 142 | 51.8% / 28.7% |
| Before leak 2 | 15.1% / 36.5% | 471 / 97 | 35.7% / 28.7% |
| Before leak 3 | 14.3% / 86.0% | 336 / 243 | 45.7% / 28.7% |
| Before leak 4 | 38.0% / 39.7% | 252 / 77 | 32.4% / 28.7% |

Read these as pictures of four leaks, not as a tested detector: four events on
one machine, no threshold tuned, and the normal week also has readings outside
the band. The watcher's own evaluation on this machine is in FORECAST.md.

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

## Running it

```bash
uv sync --extra dev --extra series
uv run python scripts/series.py prepare                                # once, needs data/metropt/
uv run python scripts/series.py snapshot --engine offline              # no network
uv run python scripts/series.py snapshot --engine bigquery --dry-run   # what each job may cost
uv run python scripts/series.py snapshot --engine bigquery             # the Google run
uv run python scripts/series.py spent                                  # the ledger
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
| Contribution analysis support | 0.1 | Google's default |
| Stand-in band | median of the same time of day over 14 days, plus or minus 3 robust standard deviations, spread floored at 2% of the usual range | chosen before any run; a floor, not a detector |
| Ask the data | 100 MB per query, 60 questions an hour | 100 MB is the example in Google's cost guide |
| Forecasts drawn within | loaded share 0 to 100%, motor current from 0 A | physical limits the models do not know |
