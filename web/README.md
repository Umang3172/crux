# Web

The Crux console: an operations view of the engine and the agents that drive it.
Vite + React + TypeScript, plain CSS on design tokens, charts drawn in SVG. No
component library and no charting library.

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

## What it shows

| Page | What is on it | Routes it calls |
|---|---|---|
| Overview | This browser's cases by how they ended, the case queue, the agents' latest tool calls, pinned scenarios, the autonomous run drawn call by call, the machine running | `/health`, `/machine`, `/maintenance/machines`, `/maintenance/tickets`, `/ingest/{id}`, `/investigations`, `/agent/stream` |
| Cases, Case | A whole investigation on one page: where it is in its pipeline, the agents at work on it (live while the run streams, a record afterwards), the verdict, the measurement the engine asked for with what each suspect predicts it reads, the machine with the named part marked, the virtual experiments side by side, every suspect, measured against simulated spectra, the evidence ledger, the report with its sentence check, the repair check, notes | `/investigations…`, `/agent/stream`, `/machine`, `/replay`, `/capture`, `/spectrum`, `/tests` |
| Agents | The two agents, the tools each was given and what each takes, the limits on a run, which model does each job | `/agent/about`, `/health` |
| Proof | The evaluation run's figures, each with its source | none: `src/data/evaluation.ts` |
| Machines, Machine | The pump model drawn with its parts turning; a part's health over its life against a clock, the alarm, the time-left range, risk before a planned stop, an investigation at an hour | `/machine`, `/maintenance/…`, `/ingest/{id}` |
| Work orders | Work orders drafted from forecast alarms, with cited evidence and approval by name; what a repair found | `/maintenance/tickets…`, `/fleet/outcome` |
| Lens scans | A phone video read for motion and sound | `/lens/…` |
| Network | This site's forecasting model, an update waiting for a decision, lessons | `/fleet/…` |
| System | Health, the model behind each AI job, the measurements catalogue, links to the API reference | `/health`, `/tests`, `/agent/about`, `/docs` |
| Phone check | The open measurement on a phone, reached by a QR code on the case page | `/investigations/{id}`, `/replay`, `…/evidence` |

## Layout

```
src/
  api/        types and calls: the one door to the server
  app/        the shell: navigation, command palette (Cmd-K), new-case dialog, routes
  lib/        session store, the case model, scenarios, formatting, plain words,
              liveruns.ts (runs as they stream) and playback.ts (showing one call by call)
  data/       the evaluation run's figures
  styles/     tokens.css (every colour and size), base.css, ui.css (the components),
              viz.css (the moving drawings)
  ui/         kit.tsx (components), charts.tsx (SVG charts), QrCode.tsx,
              AgentStage.tsx (the agents at work), MachineTwin.tsx (the machine running)
  pages/      one file per page; pages/case/ holds the case page's panels
```

## The rules it keeps

**Every number on screen is one the server returned**, or one of the evaluation
run's figures in `src/data/evaluation.ts`. Nothing here computes a posterior, a
correlation or an information gain. If the UI would have to calculate something
to display it, that calculation belongs in the engine, where it is tested and can
be argued with.

**Motion carries a number.** In the machine drawing every part turns at its
ratio to the shaft as `GET /machine` reports it, slowed by a stated factor; a
flash where a ball meets a damaged spot is not drawn in, it falls out of those
ratios. On the agents' stage every packet is one recorded tool call. Nothing
moves for decoration, and the drawings stand still when the visitor's system
asks for less motion.

**Colour has one meaning each** (`styles/tokens.css`): blue is the engine's voice
and the measurement it asks for; violet is anything a language model did or
wrote; cyan is a simulation; green, amber and red are an outcome, something
waiting on a person, and a hazard.

**Two voices are never mixed.** The engine's sentences carry "the engine's
words". A language model's sentences carry the model's name, and the ones the
sentence check removed are shown struck out with the reason.

**Synthetic is labelled synthetic, and a stand-in is labelled a stand-in.** The
pump every case runs on is the engine's physics model. With no model credentials
a scripted stand-in drives the agents' tools; every screen that shows its work
says so.

**Answer keys stay hidden.** Some responses carry what was fed in or how a
recorded life ended. The console shows them only when a person asks ("Reveal",
"Show what really happened").

## Where state lives

The server keeps cases in memory and shares them between visitors, and it returns
an agent run once without storing it. So each browser keeps its own session in
local storage (`lib/session.ts`): the cases it opened, the last state it read of
each, and what people recorded on them. A case the server has since forgotten is
still shown, marked as kept only in the browser. "Reset session" starts a new one
with a new plant id, which also gives the pump a clean history of earlier cases.

## Still open

- **Beliefs during an agent run.** The stream carries each call and each answer
  in words, not the beliefs after it, so the stage cannot show beliefs moving
  step by step. An engine case can: the browser keeps the beliefs before and
  after each reading.
- **A run that outlives the page.** The server sends a run once. Reload while
  the agents are working and the run is lost to this browser.
- **A work order for a case.** The server stores work orders only for forecast
  alarms. A case's recommendation is approved on the case and the approval is
  kept in the browser.
- **Live rig.** The Machines page shows the sensor's status. Investigating a live
  capture from the console is open work.
- **Tests.** There are none for the UI; `npm run build` type-checks it.
