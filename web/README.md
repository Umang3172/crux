# Web

The investigation view. Vite + React + TypeScript.

```bash
npm install
npm run dev          # http://localhost:5173, expects the API on :8080
```

Point it somewhere else with `VITE_API_BASE=https://…` in `.env.local`.

## What is here

A working skeleton: pick a fault, run a full investigation through `/replay`,
and watch the transcript, the beliefs and the ledger.

## What lane C builds on top

1. **Hypothesis constellation** — nodes sized by posterior, rivals shrinking as
   experiments run. This is the shot the deck opens with.
2. **Real against simulated** — two spectra overlaid, the simulated one morphing
   between hypotheses with the correlation beside it (`uplot` is already a
   dependency; it handles long signal traces without dropping frames).
3. **The measurement request** — the card that appears when the agent needs a
   human, with the coaching steps from `GET /tests`.
4. **The ledger** — entries appearing as they are created, each clickable to
   highlight which hypotheses it supports or contradicts.

Keep the meaning in the API. If the UI has to compute something to display it,
that computation probably belongs in the engine.
