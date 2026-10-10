# Real data: the CWRU bearing set

Every number in the demo comes from a signal we generated ourselves. That is a
fair question for a judge to ask about, and this is the answer: one command that
runs the same investigator over recordings from somebody else's rig, with faults
somebody else induced.

```bash
uv run python scripts/fetch_cwru.py   # a human runs this once; it downloads ~100 MB
uv run hypengine benchmark
```

Without the data, `hypengine benchmark` prints how to get it and exits 0, and the
test suite skips the few assertions that need real files. Nothing else in the
repository touches the network.

## Where it comes from

Case Western Reserve University Bearing Data Center,
<https://engineering.case.edu/bearingdatacenter>. Accelerometer recordings from a
2 hp Reliance Electric motor with a single-point fault spark-eroded into the
drive-end bearing (SKF 6205-2RS JEM), at four motor loads.

**Licence and attribution.** CWRU make the data freely available on condition
that they are acknowledged as the source. We do not redistribute it: `.gitignore`
excludes `data/cwru/*`, and each person fetches their own copy. Any slide, README
or pitch that quotes a benchmark number must name CWRU as the source of the data.

We use the **12 kHz drive-end** fault recordings and the four healthy baselines.
The baselines were recorded at **48 kHz**, not 12: Smith & Randall, "Rolling
element bearing diagnostics using the Case Western Reserve University data: A
benchmark study", Mechanical Systems and Signal Processing 64-65 (2015)
100-131, Table A1 ("48 k normal baseline data; fs = 48 kHz"). The CWRU download
page gives no rate for them. Read at 12 kHz, every line of a healthy recording
sits at a quarter of its frequency, so the loader brings a baseline down to
12 kHz and says so in the capture's `source`. It also checks the rate against
the file: the shaft line must sit where the file's own speed puts it. If it
does not, and it does at the other rate, the file is believed over the
document (some mirrors publish baselines already at 12 kHz). The 48 kHz *fault*
recordings are not fetched.

## The naming convention

CWRU publish files as bare numbers (`105.mat`). `scripts/fetch_cwru.py` saves
them under the dataset's own descriptive convention instead, because
`data/cwru.py` reads the ground truth straight out of the filename — no lookup
table to drift out of date, and a folder a human can read.

| Name | Fault | Diameter | Clock | Load | Fallback rpm |
|---|---|---|---|---|---|
| `normal_0.mat`, `97.mat` | healthy | — | — | 0 hp | 1797 |
| `IR007_1.mat` | inner race | 0.007 in | — | 1 hp | 1772 |
| `IR021_3.mat` | inner race | 0.021 in | — | 3 hp | 1730 |
| `OR007@6_0.mat` | outer race | 0.007 in | 6 o'clock | 0 hp | 1797 |
| `OR021@6_2.mat` | outer race | 0.021 in | 6 o'clock | 2 hp | 1750 |
| `B007_0.mat` | ball | 0.007 in | — | 0 hp | — |

The digits after the fault code are the defect diameter in **thousandths of an
inch**. `@6` is where on the stationary outer race the defect sits, in clock
positions; 6 o'clock is inside the load zone. The trailing digit is the motor
load in horsepower. A descriptive prefix some mirrors add
(`12k_Drive_End_IR007_0.mat`) is tolerated.

**Numbers with a source**, in the `docs/DOMAIN.md` sense:

- `LOAD_TO_RPM = {0: 1797, 1: 1772, 2: 1750, 3: 1730}` — approximate shaft speed
  at each load, from the CWRU dataset description. It is a *fallback*: a file
  carrying its own `X###RPM` variable always wins. This matters because BPFO is
  3.58× shaft speed, so the 67 rpm spread across that table moves the predicted
  BPFO by about 4 Hz — wider than the ±3 Hz window the envelope peak search uses.
  Getting the speed wrong means looking for the defect in the wrong bin.
- `NORMAL_BASELINE_IDS = {97: 0 hp, 98: 1, 99: 2, 100: 3}` — the four healthy
  baselines, from the CWRU "Normal Baseline Data" table. Any *other* bare number
  is refused rather than guessed at.

## What the loader does with awkward files

The set is not uniform, so `data/cwru.py` handles each case explicitly rather
than crashing or, worse, quietly producing a wrong answer:

| Situation | What happens |
|---|---|
| No drive-end channel | Falls back to the fan end and says so in the Observation's `source`, because a fan-end sensor sees the drive-end bearing through the shaft and its impacts are weaker |
| No `X###RPM` variable | Falls back to the load table, and says so in `source` |
| Two-column array | Takes the first column; the second is a repeat acquisition |
| Neither channel present | `ValueError` naming the variables it did find |
| Ball defect (`B***`) | Refused. This engine has no ball hypothesis, so mapping one onto a race fault would manufacture a right answer |
| Bare number other than 97–100 | Refused: it carries no ground truth |
| A healthy baseline (48 kHz) | Brought down to 12 kHz; `source` says so. If its shaft line fits 12 kHz and not 48, it is read as 12 kHz and `source` says that instead |

Refusals are counted and printed by the benchmark, never silently dropped.

## What the benchmark measures

For each file: load the real capture, run a full `Investigation` — virtual
experiments against all six hypotheses, then a requested measurement if
simulation cannot separate the survivors — and record what it cost.

**Each load's healthy recording is that machine's normal.** A real machine does
not run like the textbook one, and a case scored against the textbook can be
stopped, or misled, by the machine's own quirks (ADR-0015). So the first 40% of
the healthy recording at a load is cut into four captures and kept as the
normal for every recording at that load, and each case is scored on the change
from it. The rest of that healthy recording is the healthy case itself, so
nothing is both a case and its own normal. A load with no healthy recording
falls back to the textbook machine, and the row says so. Forty percent and four
are design choices: four captures show how far the normal wanders, and most of
the recording is left for the case.

`uv run hypengine benchmark --textbook` scores every case against the textbook
machine instead, for the comparison.

**The run is written to a file**: `data/results/cwru-own-normal.json` or
`cwru-textbook.json` (`--out` moves it), with every case, the counts, the
settings, the time, and the commit that produced it. Quote a number from that
file, with the commit. The folder is not committed.

The printout leads with what each case cost and how it ended, and puts accuracy
last, on purpose:

1. **Settled by simulation alone.** The physics decided; nobody was sent to the
   machine. This is the cheapest possible outcome.
2. **Settled after a requested measurement.** The engine could not separate the
   survivors, named the cheapest deciding test, and that test settled it.
3. **Said it could not tell (unresolved).** The evidence never reached the 80 %
   bar, or the capture held a periodic impact no hypothesis explains. The case
   closes with the reason instead of a guess (ADR-0009).
4. **Mean technician-minutes per case.** The sum of `effort_min` for the tests
   that were actually performed, averaged over cases.
5. **Wrong verdicts**, then **accuracy of the verdicts given**. Accuracy is over
   the cases that ended in a verdict, so read it beside line 3: together they are
   the coverage and the risk of a system that may abstain.

Accuracy comes last because **a classifier wins accuracy and tells you nothing
about what it costs to trust it**. A classifier answers every case and sends a
technician either always or never. The claim this project makes is narrower and
more useful: it asks for a human measurement only when the physics genuinely
cannot decide, it can tell you in advance which measurement and how many minutes,
and it says so when it cannot tell. Minutes avoided and wrong verdicts are the
numbers a maintenance manager buys.

A further line, **requested a test no recording can answer**, is reported
separately and never faked. CWRU recordings contain a waveform and a speed, so a
coast-down (`speed_sensitivity`) or a housing temperature (`temp_rise_c`) has no
answer in the file. When the engine asks for one, the benchmark records the
request, answers nothing, and the case closes on what it has, which below the
bar means unresolved. Inventing a plausible value for those would make every
number above meaningless.

## What has and has not been run

No number has been produced: the recordings are not on the machine this was
written on. The loader, the split of the healthy recording, both scoring modes
and the result file are tested on made-up files in the dataset's shape, from a
simulated machine whose normal is not the textbook's (a healthy baseline at
48 kHz, an outer-race and an inner-race fault at 12 kHz). On those three,
scoring against the machine's own normal gives three right verdicts; against
the textbook it gives none, each case stopped by a line its leader does not
explain. That is a check of the plumbing and of the reason for the default, not
a result on CWRU.

## What this dataset cannot show

Be blunt about this in the pitch; it is a limit of the data, not of the engine.

- **Three of our six hypotheses are not in it at all.** CWRU induced bearing
  faults only. There is no imbalance, no misalignment and no looseness
  recording, so the benchmark exercises healthy / inner race / outer race and
  nothing else. Those three shaft-order faults are covered by the bench rig
  (`data/rig.py`, and `tests/test_active_diagnosis.py` is the regression test).
  Neither source covers everything; that is why both exist.
- **Ball defects are skipped**, as above.
- **The faults are machined, not worn.** A spark-eroded notch of a known
  diameter is cleaner and more repeatable than a real spall, which starts as a
  sub-millimetre crack and spreads. Expect real field data to be harder.
- **One bearing, one rig, one speed range.** Roughly 1730–1797 rpm under
  steady load. Nothing here shows variable-speed or variable-load behaviour,
  which is exactly what ADR-0001 says the analytical model cannot extrapolate to.
- **The requested measurement is the next stretch of the same recording.** In
  the field the engine asks for a fresh 30 s capture; a CWRU file is about ten
  seconds long. The case is opened on the first 4 seconds (`--seconds`) and a
  requested capture is answered by the 4 seconds after them, scored against
  simulations of that length. Its noise is independent of the first look, but it
  is the same sensor in the same place seconds later, and far shorter than the
  test asks for, so it adds less than a real 30 s capture would.
- **A healthy recording has to serve twice**, as the normal and as a case. Its
  length sets what is left: 40% is the normal, the rest is the case, and a
  requested capture needs a further stretch of the same length. Where the
  recording runs out, the request counts as one the recording could not answer.
  How long each baseline is has not been checked here: the files are not on
  this machine.
- **Four seconds at 12 kHz** is 48 000 samples and 0.25 Hz of frequency
  resolution, far finer than the peak search needs, and it keeps a full sweep to
  a few seconds. A recording too short for a second stretch counts the request
  as one the recording could not answer.

## If the download breaks

`scripts/fetch_cwru.py` prints every URL before it fetches anything and refuses
a file that comes back implausibly small, which is what a moved link or a
captive portal looks like. If CWRU reorganise the site, `BASE_URL` at the top of
that script is the one line to change. The open mirrors listed at the top of
`src/hypothesis_engine/data/cwru.py` are the fallback — rename what you get to
the convention above and the loader will not care where it came from.
