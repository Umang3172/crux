# Web

The Crux console: a plant's machines, what Crux is doing about each, and what
it needs from the people on site.
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

## Who it is for

Three people use a plant's maintenance console, and each starts somewhere else.
"Viewing as" in the menu picks the first page and what the menu puts first; it
hides nothing, and there are no accounts (a person approves by typing a name).

| View | Who | First page |
|---|---|---|
| Control room | The monitoring team | **Plant**: every machine, where it stands, who has to act next |
| Maintenance | Technicians | **My work**: the measurements Crux is waiting for, the approved repairs, the checks after a repair, the machines that can only be scanned |
| Manager | Whoever signs off | **Summary**: the work waiting for a name, each area's state, what Crux did |

## The plant

`lib/plant.ts` holds a demo site: three areas and the machines in them. The
layout and the names are made up and the page says so. What each machine can
do is real, because each is looked after in one of four ways the server
supports:

| Way | What it is | Its workflow |
|---|---|---|
| Investigated on demand | The engine's rotating-machine model at that machine's speed; a fault is fed in | Reading, investigate, measure, approve, repair, verify |
| Watched over its life | A part followed from new, from the server's own list | Watch, alarm, forecast, work order, approve, outcome |
| Live sensor | A sensor streaming to the server | Stream, capture, investigate, approve, repair, verify |
| Phone scan | Nothing fitted; a phone video is the only reading | Scan, confirm speed, screen, measure next |

The engine has one machine model. The modelled machines share it and differ in
speed only (`rpm` on the routes that take a capture); each keeps its own
history on the server. A pump and a fan are two drawings of the same model, and
each machine's page says so.

**Simulate a shift** sends a reading from every modelled machine that is free,
and they are investigated side by side. A machine with a measurement, a
sign-off or a repair outstanding sends nothing new until that person has acted,
so the three views have to be used in turn to move the plant on.

## What it shows

| Page | What is on it | Routes it calls |
|---|---|---|
| Plant | Areas and machines: state, who acts next, where each is along its own workflow, the shift, what Crux is doing now | `/maintenance/machines`, `/maintenance/tickets`, `/lens/scans`, `/ingest/{id}`, `/investigations`, `/agent/stream` |
| My work, Summary | The same cases, work orders and machines, arranged for a technician and for a manager | as above |
| Machine | Where it stands, how it is looked after, the machine drawn with its parts turning, its investigations | `/machine` |
| Investigations, Investigation | A whole investigation on one page: where it is in its pipeline, Crux's AI at work on it (live while the run streams, a record afterwards), the verdict, the measurement the engine asked for with what each suspect predicts it reads, the machine with the named part marked, the virtual experiments side by side, every suspect, measured against simulated spectra, the evidence ledger, the report with its sentence check, the repair check, notes | `/investigations…`, `/agent/stream`, `/machine`, `/replay`, `/capture`, `/spectrum`, `/tests` |
| A watched life | A part's health over its life against a clock, the alarm, the time-left range, risk before a planned stop, an investigation at an hour | `/maintenance/…` |
| Work orders | Work orders drafted from alarms, with cited evidence and approval by name; what a repair found | `/maintenance/tickets…`, `/fleet/outcome` |
| Phone scans | Four screens: record (the demo clip) or upload a phone video; upload; the pipeline drawn step by step as the server reports it; then a drawing of the clip's machine with the part the scan points at in red (what the model saw, or where the video shakes most), marked unconfirmed | `/lens/scans/live`, `/lens/…` |
| Lessons and updates | This site's forecasting model, an update waiting for a decision, lessons | `/fleet/…` |
| Track record | The evaluation run's figures, each with its source | none: `src/data/evaluation.ts` |
| How Crux works | The two AI investigators, the tools each was given and what each takes, the limits on a run, which model does each job | `/agent/about`, `/health` |
| System | Health, the model behind each AI job, the measurements catalogue, links to the API reference | `/health`, `/tests`, `/agent/about`, `/docs` |
| Phone check | The open measurement on a phone, reached by a QR code on the investigation's page | `/investigations/{id}`, `/replay`, `…/evidence` |

## Layout

```
src/
  api/        types and calls: the one door to the server
  app/        the shell: navigation, command palette (Cmd-K), new-case dialog, routes
  lib/        plant.ts (the site, its machines and where each stands), role.ts,
              shift.ts, session store, the case model, formatting, plain words,
              liveruns.ts (runs as they stream) and playback.ts (showing one call by call)
  data/       the evaluation run's figures
  styles/     tokens.css (every colour and size), base.css, ui.css (the components),
              viz.css (the moving drawings), plant.css (areas, tiles, workflows)
  ui/         kit.tsx (components), charts.tsx (SVG charts), QrCode.tsx,
              AgentStage.tsx (Crux's AI at work), MachineTwin.tsx (the machine running),
              MachineGlyph.tsx (a machine at a glance)
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
