# Architecture

One sentence: **Gemini operates a deterministic physics engine, and when the
physics cannot decide, it buys the cheapest measurement from a human.**

```
                     ┌──────────────────────────────────────────┐
   rig / CWRU  ──▶   │  signals.features                        │
   (vibration,       │  waveform → named observations           │
    rpm, temp)       │  (1x, 2x, half-order, envelope, crest)   │
                     └───────────────────┬──────────────────────┘
                                         ▼
                     ┌──────────────────────────────────────────┐
                     │  investigation.engine                    │
                     │  hypotheses · beliefs · ledger           │
                     └───────┬───────────────────────┬──────────┘
                             │                       │
              test hypothesis│                       │still ambiguous
                             ▼                       ▼
        ┌────────────────────────────┐   ┌──────────────────────────────┐
        │ physics.signatures/synth   │   │ investigation.catalog        │
        │ predicted signal per cause │   │ tests + costs + predictions  │
        │ physics.likelihood         │   │ → expected info gain/minute  │
        └────────────┬───────────────┘   └──────────────┬───────────────┘
                     │ likelihood                       │ request
                     ▼                                  ▼
             belief update                    a person takes it: a sensor,
                     │                        a typed value, or a phone
                     │                        scan (lens.answer), each with
                     │                        its own uncertainty
                     ▼                                  │
             conclusion + ledger  ◀────────── measured value
                     │
                     ▼
          verification → lesson memory (next case starts smarter)
```

## The layers, and why they are separate

**`signals/`** returns evidence, never a score. "Envelope peak at BPFO is 86x the
median" is something an engineer can argue with; "anomaly probability 0.87" is
not, and it cannot be used to discriminate hypotheses.

**`physics/`** is deterministic and offline. Fault frequencies come from bearing
geometry (verified against the CWRU published multipliers in
`tests/test_frequencies.py`). Each hypothesis has a predicted signature, which
the synthesiser renders as a waveform and the comparator scores against reality.
Deliberately a reduced-order signal model: tones, impact trains, resonance
ringing, sidebands. No neural surrogate — see ADR-0001.

**`investigation/`** owns beliefs. Posterior ∝ prior × the likelihood of the
capture under each hypothesis (built by simulation, below; on the change from
the machine's own healthy captures when there are any) × a Gaussian
likelihood for each measured value, all at the same fault severity and averaged
over severity once. What a requested capture will read is simulated too, at the
capture's own length (ADR-0013). One method writes a posterior, and every
hypothesis stays in the distribution, so one written off early can come
back. There is no verdict below 80%, and none while the capture holds a strong
periodic impact the leader, or the whole list, does not predict: such a case
ends "unresolved".
A suspect written during the case (`OrderSuspect`, in multiples of shaft speed)
is simulated like the catalogue's and scored on everything already seen, so it
wins only by explaining the evidence better; one no capture could tell apart
from an existing hypothesis is refused.

**`agents/`** is optional. `agents/investigator.py` is an ADK graph workflow
with two agents: the investigator drives the case through `tools/` and closes
it, and the critic is called when something is explained by no suspect and may
write one (ADR-0029). A plain-code gate routes between them and decides when
the loop stops, and each run is capped in model calls and time (ADR-0011).
The critic can look in the machine's documents (`knowledge/`, ADR-0028); both
can ask how the machine's earlier cases ended (`investigation/history.py`,
ADR-0027). Neither is evidence. Without credentials a scripted
investigator runs the same loop over the same tools, so CI runs with no keys and
a laptop with no network still demos.

**A phone scan can answer a check** (`lens/answer.py`, ADR-0033). The phone's
microphone answers the envelope check and its camera the two checks that read a
ratio of shaft lines; temperature and the coast-down are refused. The reading
enters through the same door as any other (`Investigation.apply_outcome`) with
an uncertainty worked out from the clip, which widens every prediction it is
scored against, so it moves beliefs no further than it deserves.

After a verdict and a repair, `investigation/repair.py` investigates a new
capture as a case of its own, with the same suspects at even odds and the same
normal, and reports what the machine is now: the repair verified, the fault
still there, another fault in its place, or not settled (ADR-0024). No expected
improvement is typed anywhere.

A closed case is written up by `agents/report.py` (ADR-0021). The verdict, the
reason, the action and what would change it are the engine's own lines. A model
may add an explanation of a verdict, and each of its sentences is kept only if
the evidence it cites backs it; the ones that fail are listed with the reason.

**`api/`** serialises state. `/replay` runs a whole case end to end for anyone
without the rig, which is how a judge sees this working from the deployed link.

## The comparison, in detail

`physics/likelihood.py` scores a capture against each hypothesis:

1. **The lines the hypotheses predict.** Every tone in the raw spectrum, every
   impact rate in the envelope spectrum with its second harmonic and its 1x
   sidebands, in multiples of shaft speed, searched within ±2 % because bearings
   slip. Each line is read as its height above the local floor, so a predicted
   line that is not there reads near zero.
2. **What each hypothesis predicts for those lines.** The simulator renders the
   hypothesis at five severities, four seeds each, at the capture's speed and at
   its measured noise level, and the same measurement reads every simulation.
3. **A robust likelihood.** Each line is scored with a Student-t around the
   simulated mean, widened for model mismatch; severities are averaged.

Why not a correlation of spectra, which is what this used to be: a correlation
cannot credit a hypothesis for predicting that a peak is absent, so a healthy
capture and an unbalanced one both scored best against the outer race
(ADR-0008). `physics.compare` still computes the correlation, and the UI shows
it beside the plot of one simulation, as a picture of the fit.

Before concluding, `unexplained_envelope_line` looks for a periodic impact the
hypotheses do not predict, above a threshold set for a 1 % false-alarm rate per
capture on noise. One that no hypothesis on the list predicts, stronger than
anything the list explains, blocks a verdict at any belief, and no measurement is
requested for it, since none could settle it. One the leader alone leaves out
blocks once the leader reaches the bar. Either way the list is missing a cause:
the investigator matches the line to the bearing's own frequencies and may write
the suspect, which the physics then tests (ADR-0012).

## Where evidence comes in

Everything that can move a belief enters the engine through one of two doors,
and nothing else does. Each of the other packages says so at the top of its
own file.

| What arrives | From | Door | What the engine does with it |
|---|---|---|---|
| A vibration capture, with the machine's bearing, speed and sample rate | The synthetic rig (`data/rig.py`), a CWRU file (`data/cwru.py`), one recording of a run (`data/xjtu.py`) | `Investigation(machine, observation)`, or `tools.cases.open_case` for a case an agent works | Measures the speed from the capture, reads the lines every hypothesis predicts, scores each hypothesis by simulation |
| Healthy captures of the same machine | The start of a recorded run (`investigation/recorded.py`); any capture taken when the machine ran normally | The `normal=` argument of the same call | Scores the case on the change from them (`physics/normal.py`, `docs/DOMAIN.md`) |
| The answer to a requested measurement, as a number | A technician; the replay rig | `apply_outcome`, or `tools.cases.record_measurement` | Scores it against what each hypothesis was simulated to read |
| The answer as a capture | A sensor; the next recording of a run | `apply_capture`, or `record_measurement` with the capture | Reads the feature itself, at the capture's own length and noise |
| "Nobody can take it" | Any of the above | `could_not_take`, or `tools.cases.mark_unanswerable` | Moves to the next most useful measurement and says so in the verdict |
| A suspect not on the list | The investigator model, as frequencies in multiples of shaft speed | `add_hypothesis`, through the `propose_suspect` tool | Simulates it and scores it on all the evidence so far; refuses a duplicate |
| Batches from a live sensor | The rig's firmware, a second at a time | `POST /ingest`, kept by `data/stream.py` | Nothing until a person opens a case on the latest two seconds, or marks them as the machine's normal |

What stays outside, by design:

- **The watcher and forecaster** (`forecast/`) say *when* a part needs
  attention, from a health trend. They hand the engine a moment in a recording
  and never read or write a belief.
- **The ticket** (`ticket/`) quotes the engine's outcome as one of its evidence
  items. The camera look on it is marked unconfirmed and never reaches the
  engine.
- **Lens** (`lens/`) points the same signatures at a phone's video and sound and
  reports agreement scores. They are not beliefs, and a scan does not open a
  case.
- **Lessons** (`fleet/`) are knowledge for the technician and the ticket
  writer, never evidence.
- **A language model** (`agents/`) calls tools that read the case and ask the
  physics for the next step. No tool takes a probability, a score or a reading
  from it (ADR-0007). It cannot close a case the evidence settles, and when it
  closes one without a verdict the reason on record is the engine's (ADR-0022).
- **The report** (`agents/report.py`) reads a closed case and changes nothing
  in it.

The callers that used to reach into the engine (`api/maintenance.py`,
`scripts/diagnose_runs.py`) go through `investigation/recorded.py`, so a
recorded run is investigated the same way wherever it is asked for.

## Data flow at the edge

```
ESP32 + MPU6050 ──(wifi, one-second batches)──▶ POST /ingest ──▶ latest unbroken minute
                                                                    │
                     POST /ingest/{machine}/normal ◀── a person ────┤  "this is it running normally"
                     POST /ingest/{machine}/investigate ◀───────────┘  a case on the latest two seconds
```

`data/stream.py` keeps the signal; nothing in it reads the signal. A batch that
does not follow on from the last one starts a new stretch, so a gap is never
bridged. The routes that write are off unless the server is given
`RIG_INGEST_TOKEN`, and then need it: the deployed link is open to anyone. The
stretch and the marked normal live in memory and are gone on a restart. The rig
samples at 2 kHz, below the bearing resonance band, so a case opened this way
weighs shaft-order faults only and says so (`docs/HARDWARE.md`).

Tested with batches made the way the firmware makes them, from synthetic signal
(`tests/test_ingest.py`); not yet with the hardware. The camera coach in
`docs/HARDWARE.md` is not built.

With no hardware and no recordings, `data/rig.py` produces captures that behave
like the rig, generated from a *different* seed than the simulator the
investigator runs, and `data/demo.py` a whole bearing life for the maintenance
tab. Both are the engine's own signal model, and both are labelled synthetic
wherever they are shown.

## What is deliberately not here

No CMMS integration, no machine onboarding from manuals, and no closed-loop
control: Crux recommends, a person approves and acts. Lessons carried between
sites and the time-left forecast, which an earlier version of this page listed
as absent, are built (`docs/LEARNING.md`, `docs/FORECAST.md`). What is still
open is under "Known limits" in the README.
