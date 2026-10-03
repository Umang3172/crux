# When to fix: the forecaster

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

## Getting the data (a human does this)

| Set | Role | Get it | Put it in |
|---|---|---|---|
| XJTU-SY, 15 bearings, accelerated run-to-failure | fit and compare | links at biaowang.tech/xjtu-sy-bearing-datasets (Google Drive, Dropbox, ...). Cite Wang et al., IEEE Trans. Reliability 69(1):401-412, 2020 | `data/xjtu/<condition>/BearingX_Y/N.csv` |
| IMS (NASA), 3 tests, 4 bearings each | transfer test only | `uv run python scripts/fetch_ims.py` | `data/ims/<1st_test etc.>/<timestamp files>` |

Both folders are git-ignored. Nothing in the code repo downloads anything.

**Before quoting any IMS number**, open the readme inside IMS.zip and check
`IMS_FAILURES` and the channel mapping in `forecast/runs.py` against it. They
are written from the commonly cited description and have not yet been checked
against the file.

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
| `IMS_FS_HZ` | 20 kHz (1 s snapshots, every 10 min) | arXiv 1703.06272 (secondary); interval read from file names |
| `DANGER_FACTOR` | 10x the largest healthy amplitude | XJTU-SY failure definition (Wang et al. 2020, restated in PMC9919518; secondary). Applied to IMS for consistency; not IMS's own criterion |
| `SIGMA_K` | 3 | Shewhart control limit |
| `BASELINE_SNAPSHOTS`, `MIN_RISE`, `CONSECUTIVE` | 10, 20%, 3 | chosen; see `onset.py` |
| `TREND_WINDOW` | 15 snapshots | chosen |
| `BANDS_HZ` | 0–1, 1–3, 3–6, 6–10 kHz | chosen; 10 kHz is the IMS Nyquist limit |
| GBM settings | 300 trees, rate 0.05, 15 leaves, 20 per leaf | chosen once, not tuned on held-out bearings |

## Known limits

- XJTU-SY bearings were worn out on purpose in hours. Minutes learned there do
  not carry over to a plant where wear takes months; only unit-free quantities
  (the residual model, the trend) can, and the IMS test checks that.
- IMS tests did not stop at the 10x line, so the trend aims at a line those
  bearings may never have reached.
- IMS bearings that survived their test (censored) are never scored.
- One accelerometer per bearing: horizontal on XJTU-SY, the first channel on IMS.
- XJTU-SY includes two cage failures and two bearings with several damaged
  elements. The forecaster does not care which part failed; the investigation
  engine has no cage hypothesis, so those bearings test its "I don't know".
