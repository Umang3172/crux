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
             belief update                    agents.gate (Jev) +
                     │                        Gemini Robotics-ER 2
                     │                        coach a person through
                     │                        the measurement
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
capture under each hypothesis (built by simulation, below), then multiplied by a
Gaussian likelihood for each measured value. One method writes a posterior, and
every hypothesis stays in the distribution, so one written off early can come
back. There is no verdict below 80%, and none while the capture holds a strong
periodic impact the leader does not predict: such a case ends "unresolved".
A suspect written during the case (`OrderSuspect`, in multiples of shaft speed)
is simulated like the catalogue's and scored on everything already seen, so it
wins only by explaining the evidence better; one no capture could tell apart
from an existing hypothesis is refused.

**`agents/`** is optional. Gemini explains and drafts; Jev gives the per-second
typed verdicts while somebody takes a measurement. Both have offline fallbacks,
so CI runs with no keys and a laptop with no network still demos.

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
leader does not predict, above a threshold set for a 1 % false-alarm rate per
capture on noise. If it is stronger than anything the leader explains, the list
is missing a cause and the case cannot conclude.

## Data flow at the edge (once the rig is live)

```
ESP32 + MPU6050 ──(wifi, batched JSON)──▶ /ingest ──▶ ring buffer ──▶ Observation
phone camera    ──(Live API frames)────▶ ER 2 ──▶ Jev gate ──▶ measurement accepted
```

Until then `data/rig.py` produces captures that behave like the rig, generated
from a *different* seed than the simulator the investigator runs, so a passing
test is not a signal compared with itself.

## What is deliberately not here

No fleet layer, no CMMS integration, no remaining-useful-life model, no machine
onboarding from manuals, no closed-loop control. Every one of those is on the
roadmap slide; none of them is in a 25-day build. See `docs/TASKS.md`.
