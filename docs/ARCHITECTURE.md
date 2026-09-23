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
        │ physics.compare            │   │ → expected info gain/minute  │
        └────────────┬───────────────┘   └──────────────┬───────────────┘
                     │ correlation                      │ request
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

**`investigation/`** owns beliefs. Posterior ∝ prior × exp(k · correlation),
then multiplied by a Gaussian likelihood for each measured value. Both steps are
about twenty lines and are the only places a belief can move.

**`agents/`** is optional. Gemini explains and drafts; Jev gives the per-second
typed verdicts while somebody takes a measurement. Both have offline fallbacks,
so CI runs with no keys and a laptop with no network still demos.

**`api/`** serialises state. `/replay` runs a whole case end to end for anyone
without the rig, which is how a judge sees this working from the deployed link.

## The comparison, in detail

A raw spectrum alone cannot tell an outer-race defect from imbalance: both put
energy at low frequency, and the impacts smear. So `physics.compare` scores two
things and averages them:

1. **Raw spectrum, 0–500 Hz** — shaft orders (1x, 2x, 3x, half-orders).
2. **Envelope spectrum, 0–400 Hz** — band-pass the resonance, Hilbert, FFT.
   This is where BPFO and BPFI actually appear.

Before this change, imbalance scored 0.99 against an outer-race signal. After it,
0.49 against the outer race's 1.00. The lesson is in ADR-0003.

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
