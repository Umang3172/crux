# Web

The investigation view. Vite + React + TypeScript + uPlot, no component library.

```bash
npm install
npm run dev          # http://localhost:5173, expects the API on :8080
npm run build        # -> dist/, which the container serves at /
```

In production the container serves this bundle and the API from one origin, so
the client uses relative paths. `VITE_API_BASE=https://…` in `.env.local` points
a dev server at an API somewhere else; the dev server also proxies the API paths,
so `VITE_API_BASE=""` behaves exactly like the deployed build.

For the full thing locally, including the spectrum plot:

```bash
make web-build && make serve-app     # http://localhost:8080
```

## What it does

It is built for the thirty seconds a judge spends on the deployed link. The page
opens a case on arrival and plays the investigation back one engine state at a
time: beliefs moving, the ledger growing, the moment the agent stops and asks a
person for a measurement, then the verdict and what would overturn it.

| File | |
|---|---|
| `api.ts` | Types mirroring `api/app.py::serialise`, and the calls |
| `run.ts` | Drives one case and cuts it into playable steps |
| `components/Beliefs.tsx` | The distribution across hypotheses |
| `components/Ledger.tsx` | The append-only evidence timeline |
| `components/RequestCard.tsx` | What it asked a human for, why, and what it cost |
| `components/Spectrum.tsx` | Measured against the winning hypothesis, raw and envelope |
| `components/Conclusion.tsx` | Root cause, action, what would change my mind |
| `theme.css` | Tokens. The palette carries meaning — see the note at the top |

## The one rule

**Every frame is a state the API returned.** Playback controls the order things
are revealed in, never their values. Getting a belief *trajectory* rather than
just a verdict is why `run.ts` walks the real endpoints — `/replay` for the
values the rig oracle produced, then `/investigations` and `.../evidence` to step
through the same case one round at a time — instead of interpolating between two
snapshots. Nothing in here computes a posterior, a correlation or an information
gain. If the UI would have to calculate something to display it, that calculation
belongs in the engine, where it is tested and can be argued with.

The one assumption the UI states rather than reads is the opening frame: the
engine starts from a uniform prior over its candidates
(`Investigation.__init__`), and the API does not serialise priors. It is labelled
as such on screen.

## Still open

- **The hypothesis constellation** — nodes sized by posterior, rivals shrinking.
  Bars won for now: they read at a glance and they animate honestly. Revisit if
  the deck needs a hero shot.
- **The coached measurement** — the phone view, ER 2 watching sensor placement,
  chips turning green. Gated on ADR-0005 and the 5 October kill switch.
- **Live rig** — this view only replays synthetic captures. Pointing it at
  `/ingest` is a week-3 item in `docs/TASKS.md`.
