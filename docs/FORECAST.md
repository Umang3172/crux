# Predictive maintenance: when to fix, and a health percent

The investigation decides **what** is wrong. This answers **when** it becomes
urgent: how many minutes until the bearing's vibration crosses the danger line,
as a range (10th, 50th, 90th percentile), never as a single date.

Code: `src/hypothesis_engine/forecast/`. It does not import the investigation
engine, never reads or writes a belief, and is not part of the physics layer
(the learned model has weights; the physics layer must not).

## How it works

1. **Health trend** (`health.py`). Each snapshot becomes RMS, peak, kurtosis,
   crest factor and the share of energy in four frequency bands. No bearing
   geometry is needed, so the same code runs on any rig sampled at 20 kHz or more.
2. **Watcher** (`onset.py`). Compares RMS with this bearing's own first
   snapshots and fires once it stays above the limit for three snapshots in a
   row. Strictly causal. No forecast is made before it fires.
3. **Forecasters** (`models.py`), all answering with p10/p50/p90:
   - `average-life`: how long the training bearings lasted after their onset. Ignores the signal.
   - `trend`: fits recent growth of log(peak) and extends it to the danger line. No training, numpy only. This is the fallback. Same family as the dataset authors' own method, which fits exponential degradation models after smoothing (Wang et al. 2020, abstract).
   - `gbm-direct`: gradient-boosted trees (scikit-learn, quantile loss) learn the minutes left.
   - `gbm-residual`: the same trees learn how wrong the trend is. That ratio has no units, so it has a chance of carrying over to a rig with a different time scale.
4. **Evaluation** (`evaluate.py`). Leave-one-bearing-out on XJTU-SY, then train on all of XJTU-SY and test on IMS with no refitting. The split is always by bearing.

## Health percent

`percent.py` turns the same trend into one number per part, like a phone's
battery health: 100% vibrates as it did when new, 0% is at the danger line.

- Each doubling of the peak above its healthy maximum costs the same,
  log10(2), about 30 points, because vibration grows by multiplying.
- A trailing median of `SMOOTH_SNAPSHOTS` stops one knock moving the number.
- It never rises again, because damage does not heal.
- A machine shows its worst part (`weakest`), and a part the watcher has
  flagged outranks a lower number on a part it has not.

It is not life left, so it is never shown alone. `health_card()` adds the
watcher's status and, once it has fired, the time-left range. `evaluate`
reports what the percent read before each failure.

On IMS (development set), the peak-based percent fell before the RMS watcher
fired on test 1 bearing 3: below 50% about 51 running hours before the end,
when the watcher fired 5 hours before it. The ratchet also locks in shaking
from a failing neighbour: test 3 bearing 4 survived but ends at 54%.

## The screen

The web app's "Predictive maintenance" view replays recorded bearing lives:
scrub or play the timeline, and every battery, alarm and time-left range is
what Crux would have said at that moment from the snapshots so far. "Show what
really happened" adds the true failure. One machine is an IMS test (four
bearings on one shaft, shown as its worst part) or one XJTU-SY run.

```bash
uv run python scripts/forecast.py replay     # writes data/forecast/replay.json
```

`replay` gives every part a time-left model fitted on every *other* failed
part, so no range on screen comes from a model that saw that bearing. Without
`replay.json` the API falls back to the trend. `GET /maintenance/machines` and
`GET /maintenance/machines/{id}` serve it (`api/maintenance.py`); with no health
tables on the server the list is empty and says why.

## A different machine: MetroPT-3

`metropt.py` runs the same watcher on a metro train's air compressor (UCI
dataset 791, CC BY 4.0): no vibration, and the failures are air leaks. The signal
was fixed from what a leak does before any failure window was looked at: the
share of time the compressor runs loaded (`DV_eletric`), over the trailing 24
hours. The first month is healthy, as UCI recommends, and the watcher's rules
are unchanged. `scripts/forecast.py metro` reports, per company-reported
failure, whether an alarm came before it and how early, and how many alarms
warned of nothing.

## Results (6 Oct 2026)

Reproduce with `scripts/forecast.py evaluate`, `metro` and `scripts/diagnose_runs.py`.

**Watcher, XJTU-SY (test set, rules frozen 3 Oct):** fired before failure on 14
of 15 bearings; the one it missed is a cage failure (Bearing1_4). Warning ranged
from 0.1 to 6.4 running hours on accelerated lives of 0.7 to 42 hours.

**Time left, XJTU-SY, one bearing held out (14 scored):**

| method | median error / life after alarm | inside p10–p90 (aim 80%) | p10 too late |
|---|---|---|---|
| average-life | 2.00 | 52% | 40% |
| trend | 0.69 | 27% | 49% |
| gbm-direct | 0.59 | 34% | 34% |
| gbm-residual (shipped; chosen before the test) | 0.60 | 42% | 33% |

The learned models beat both baselines on error, but the ranges are too
narrow: the truth falls inside p10–p90 well under the 80% they claim, and a
third of the time even the early end is too late.

**Learned at one lab, used at another:** trained on XJTU-SY and tested on IMS
with no refitting, gbm-residual scores 0.45 / 32% / 17% and gbm-direct 0.41 /
22% / 2%; trained on three IMS bearings instead (development run), gbm-residual
scored 1.59 / 43% / 28%. Four IMS bearings: a hint, not proof.

**MetroPT-3:** the unchanged watcher warned before 1 of 4 air leaks (22 hours
ahead), came during 2 and missed 1, with about 7 alarms a month that warned of
nothing. The first month is not representative of later use; a load-aware
baseline is the open fix.

**Diagnosis at the alarm (XJTU-SY, engine as on this branch):** first read: 1
right and confident, 3 "cannot tell" where that is the right answer, 10
unresolved. With checks answered from the next recorded minute: 2 right, 4
confidently wrong (including the cage failure called outer race), 2 right to
say it cannot tell, 6 unresolved. The investigation is not yet fit to name a
fault on these bearings; tickets say "not investigated yet" until it is.

**Data note:** in our copy of XJTU-SY, `40Hz10kN/Bearing3_4/1105.csv` came out
truncated where it spans two volumes of the multi-part archive; the table
builder leaves unreadable files out and says so.

## Repair tickets and the CCTV look

`ticket/` turns an alarm into a draft work order (`POST /maintenance/tickets`):
health, alarm, time-left range, the chance of reaching the danger line before
the next planned stop (`forecast/schedule.py`, the range read as a
log-normal), a CCTV still and what an inspector saw in it, and the bearing to
have ready. A writer (Gemini, or templates offline) turns the evidence into
sentences that cite it, and `check` drops any sentence with a number its
evidence does not hold. A person approves the ticket; nothing touches the
machine. The dataset's answer key is never read.

Cameras are listed per machine in `data/cameras.json` (git-ignored, like the
stills): `{"<machine id>": {"kind": "file" | "http", "path" | "url": ..., "label": ...}}`.
With `GOOGLE_API_KEY` set, Gemini looks at the still and returns typed
findings, marked unconfirmed on the ticket. Until then a local model can do the
same on this machine: `OLLAMA_MODEL=gemma4:latest uv run hypengine serve` uses
Gemma 4 through Ollama (`agents/ollama.py`) for the ticket writer, the camera
look and the narrator. Without either, the still is attached and the ticket says
nobody has looked at it.

Two guards hold whichever model writes: a sentence whose numbers are not in the
evidence it cites is removed, and evidence a ticket must state (reading, alarm,
range, planned-stop risk, camera, cause, part) that no kept sentence cites is
put back in its template wording. On a first try (6 Oct 2026), Gemma 4 8B
reported "loose fasteners" at 0.8 to 0.9 confidence on two normal rig photos;
the camera prompt now asks only for problems plainly visible in a photo, and on
the same photos it reports nothing.

## Getting the data (a human does this)

| Set | Role | Get it | Put it in |
|---|---|---|---|
| MetroPT-3, one air compressor, 4 reported air leaks | the watcher on a non-vibration machine | archive.ics.uci.edu/dataset/791 (208 MB CSV) | `data/metropt/MetroPT3(AirCompressor).csv` |
| XJTU-SY, 15 bearings, accelerated run-to-failure | fit and compare | links at biaowang.tech/xjtu-sy-bearing-datasets (Google Drive, Dropbox, ...). Cite Wang et al., IEEE Trans. Reliability 69(1):401-412, 2020 | `data/xjtu/<condition>/BearingX_Y/N.csv` |
| IMS (NASA), 3 tests, 4 bearings each | transfer test only | `uv run python scripts/fetch_ims.py` | `data/ims/<1st_test etc.>/<timestamp files>` |

Both folders are git-ignored. Nothing in the code repo downloads anything.

IMS.zip holds three `.rar` archives and the readme PDF; `bsdtar -xf <file>.rar`
(built into macOS) unpacks them. `IMS_FAILURES`, the channel mapping and the
file counts were checked against that readme on 3 Oct 2026.

### What the IMS files hold that the readme does not say

- **Pauses.** Test 1 spans 34.5 calendar days but only about 14 days of
  running: the readme says longer gaps mean the test resumed the next working
  day. Times are running minutes; a pause counts as one 10-minute interval.
- **Snapshots after the stop.** Tests 2 and 3 end with files at about 1% of the
  normal level, recorded after the machine was off. `trim_stopped()` drops them,
  so failure is the last live snapshot.
- **Test 3 is longer than documented.** The readme says 4,448 files ending
  4 Apr 2004; the archive has 6,324 ending 18 Apr. Bearing 3 is flat at about
  0.07 g through 4 Apr and only rises, roughly elevenfold, on 15-18 Apr, so the
  documented failure is in the full archive. All of it is used.

## Development and test sets

IMS was opened first and used to set the watcher (the restart drift that moved
`MIN_RISE` from 20% to a doubling) and the stop rule. That makes IMS a
development set: its scores are not evidence. Every rule was fixed on
3 Oct 2026 before any XJTU-SY file was opened; XJTU-SY, held out one bearing at
a time, is the test.

## Run it

```bash
uv pip install -e ".[forecast]"
uv run python scripts/forecast.py table      # once; reads every snapshot (slow)
uv run python scripts/forecast.py evaluate   # writes data/forecast/results.{json,md}
uv run python scripts/forecast.py train      # writes data/forecast/model.pkl
```

`get_forecaster()` uses `data/forecast/model.pkl` when it exists and
scikit-learn is installed; otherwise it uses `trend`. Everything runs locally.
A cloud backend (for example a hosted time-series model) would plug in behind
the same `Forecaster` protocol.

## Reading the results

Per held-out bearing, every snapshot from the watcher's alarm to failure is
scored, then averaged within the bearing, then across bearings:

- **median error / life after onset**: 0.10 means the middle estimate is
  typically off by a tenth of the time the bearing had left once the alarm fired.
- **inside p10–p90**: should be near 80% if the range is honest.
- **p10 too late**: share of moments where even the early end of the range was
  after the real failure. This is the dangerous mistake; it should be near 0.

A learned model is only worth shipping if it beats both `average-life` and
`trend` on held-out bearings. If it does not, the result says so.

## Numbers and where they come from

| Constant | Value | Source |
|---|---|---|
| `XJTU_FS_HZ`, `XJTU_INTERVAL_MIN` | 25.6 kHz, 1 min (1.28 s snapshots) | biaowang.tech/xjtu-sy-bearing-datasets (dataset authors, read 3 Oct 2026) |
| `XJTU_BEARING` | LDK UER204: 8 balls, 7.92 mm, 34.55 mm mean diameter, 0 deg | same page, bearing table |
| `XJTU_BEARINGS` | files and failed element per bearing | same page, dataset table. `test_real_xjtu_download_is_complete` checks a download against it |
| `IMS_FS_HZ`, `IMS_INTERVAL_MIN` | 20 kHz, 20,480-point snapshots every 10 min | IMS readme (inside IMS.zip) |
| `IMS_FAILURES`, `IMS_FILES` | which bearings failed; files per test | IMS readme; test 3 count from the archive (see above) |
| `DANGER_FACTOR` | 10x the largest healthy amplitude | XJTU-SY failure definition (Wang et al. 2020, restated in PMC9919518; secondary). Applied to IMS for consistency; not IMS's own criterion |
| `SIGMA_K` | 3 | Shewhart control limit |
| `BASELINE_SNAPSHOTS`, `CONSECUTIVE` | 10, 3 | chosen; see `onset.py` |
| `MIN_RISE` | the level doubles | set on IMS (development set): healthy bearings drift up to about 25% between restarts |
| `STOPPED_FRACTION` | 10% of healthy RMS | chosen; IMS stop files sit near 1% |
| `TREND_WINDOW` | 15 snapshots | chosen |
| `SMOOTH_SNAPSHOTS` | 6 snapshots | chosen; see `percent.py` |
| `WINDOW_H`, `REACH_H` (MetroPT-3) | 24 h, 24 h | chosen; see `metropt.py` |
| `BANDS_HZ` | 0–1, 1–3, 3–6, 6–10 kHz | chosen; 10 kHz is the IMS Nyquist limit |
| GBM settings | 300 trees, rate 0.05, 15 leaves, 20 per leaf | chosen once, not tuned on held-out bearings |

## Known limits

- XJTU-SY bearings were worn out on purpose in hours. Minutes learned there do
  not carry over to a plant where wear takes months; only unit-free quantities
  (the residual model, the trend) can, and the IMS test checks that.
- IMS tests did not stop at the 10x line: no IMS bearing's peak reaches it, so
  the trend aims at a line those bearings never crossed.
- On a shared shaft, a failing bearing shakes its neighbours: on IMS the watcher
  also fires on healthy neighbours, always after the failing bearing.
- RMS is a late signal for some faults. On IMS test 1 the inner-race bearing's
  kurtosis rose from about 3.7 to over 7 roughly three days before its RMS
  doubled. The watcher does not use kurtosis yet.
- IMS bearings that survived their test (censored) are never scored.
- One accelerometer per bearing: horizontal on XJTU-SY, the first channel on IMS.
- XJTU-SY includes two cage failures and two bearings with several damaged
  elements. The forecaster does not care which part failed; the investigation
  engine has no cage hypothesis, so those bearings test its "I don't know".
