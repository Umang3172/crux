# The three-minute demo

The judging video. Every beat should be something the system really did.

| Time | Scene | What must be on screen |
|---|---|---|
| 0:00–0:20 | **The fault** | Hands tape a coin to the blade. The rig starts to shake. The dashboard opens an investigation by itself |
| 0:20–0:50 | **Hypotheses** | Three candidates with their reasons; the physics predictions for each |
| 0:50–1:25 | **Virtual experiments** | Real against simulated, the correlation for each, two hypotheses greyed out |
| 1:25–2:05 | **The request** | "I cannot separate imbalance from looseness. Cheapest test: 10 s at the drive end, 2 minutes, no shutdown." A phone coaches the measurement, chips turn green, the value posts back |
| 2:05–2:30 | **Root cause** | The conclusion, the ledger open beside it, "what would change my mind" visible |
| 2:30–3:00 | **Repair and proof** | Coin removed, the rig captured again and investigated from scratch: "repair verified", with the fault's own line before and after. Then one line on who pays |

## Rules for the recording

1. **Record every take.** The live rig is the best part and the most likely thing
   to fail on the day.
2. **Never fake a number on screen.** If the coach is not working that day, show
   the written-instruction fallback and say so.
3. **Show `/health`** once, briefly: which models are live. It answers "is this
   actually running?" before anyone asks.
4. **One sentence of honesty** near the end: what this does not do yet (one
   machine family, three hypotheses at a time, a person approves actions). It
   reads as confidence, not weakness.

## The line to open with

> "Your monitoring system can already tell you this motor is abnormal. It cannot
> tell you why, and it will not go and find out. Watch what happens when
> something does."

## Backup plan

If the rig will not cooperate:

```bash
curl -s $DEPLOYED_URL/replay -X POST -H 'content-type: application/json' \
  -d '{"fault":"looseness","severity":0.35}'
```

`/replay` runs the whole case on a synthetic capture and returns the transcript,
the ledger and the conclusion. Have this open in a second tab, always.
