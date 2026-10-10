# Crux

**The one measurement that decides.** An investigator for faults in rotating machines.

Team **MechNova** · Google Cloud AI Builder Cup 2026 · Theme 3, Manufacturing

Most machine-health tools say a machine is abnormal. Crux works out *why*. It
holds competing physical explanations, simulates the vibration each one would
produce on this machine at this speed, and scores the real capture against all
of them. When the capture cannot decide, it asks a person for the single
measurement worth the most per minute of their time, and says what each
suspect expects it to read. Below 80% belief, or while the signal holds
something no suspect explains, it names no cause: it says "unresolved", and why.

It is not a classifier. There is no path from features to a label.

```
watch → alarm → simulate every suspect → ask for one check → verdict, or "unresolved" → ticket → a person approves
```

---

## What a language model does here, and what it cannot

Gemini works a case through eleven tools, in a loop built on the Agent
Development Kit. It reads the evidence, asks the physics which measurement to
request, narrates for the maintenance team, and, when the list is missing a
cause, writes a new suspect as the vibration it would make. The physics
simulates that suspect and scores it on all the evidence, like any other.

No tool takes a probability, a score or a reading from the model, so it cannot
set a belief. Plain code ends the loop. If the model cannot be reached, an
offline stand-in finishes the case with the same tools and the screen says so.
The Investigator tab shows every step as two voices: what the model asked, and
what the physics answered.

Elsewhere a vision model looks at a camera still or a phone video
(`ticket/camera.py`, `lens/look.py`). What it sees is shown as unconfirmed and
never reaches the investigation.

---

## The five tabs

| Tab | What it shows |
|---|---|
| **Guided** | One case on a cooling pump in plain words: the reading, every suspect tested on a virtual copy, the one check, the answer |
| **Investigator** | A language model working a case through the tools, step by step, including a fault that is not on the list |
| **Engineer view** | The same engine with every number: beliefs, spectra, the evidence ledger |
| **Predictive maintenance** | A bearing's life replayed: health, the alarm, time left as a range, the investigation at any moment, a repair ticket a person approves |
| **Lens** | A phone video of a machine: its motion at shaft speed through the same physics |

---

## Quick start

```bash
# one-time
brew install uv                        # or: pipx install uv
uv sync --extra dev --extra llm        # the llm group is the investigator agent

# the whole loop in a terminal: no keys, no hardware
uv run hypengine demo --fault outer_race
uv run hypengine investigate --fault rolling_element   # a fault the list lacks
uv run hypengine evaluate --quick                      # how often is it wrong?

# the app: all five tabs on http://localhost:8080
make web-build
make serve-app

# tests
uv run pytest
```

**No keys are required.** With none, the investigator runs its offline
stand-in and every number is the same; `GET /health` and the page header say
which models are live. Gemini is reached through Google Cloud's own login or an
API key (`.env.example`).

---

## What is measured, and what is not

**Synthetic, and labelled as such.** The demo rig and the pump life on the
maintenance tab are made by the same signal model the engine simulates with.
They show the decision rule working. They prove nothing about a real machine.

`uv run hypengine evaluate` runs 180 hard cases (three faults, three strengths,
four noise levels, five seeds), answered honestly: a requested measurement is a
new capture of the same machine in the same state.

| | Right | Says it cannot tell | Wrong |
|---|---|---|---|
| Crux | 130 | 50 | 0 |
| Naming the best spectral match | 140 | never | 40 |

The second row is the simplest thing that always answers. Crux gives up ten
right answers and forty wrong ones for fifty times it says it cannot tell.

**Real recordings.** The watcher and the time-left forecast are evaluated on
two public run-to-failure sets ([`docs/FORECAST.md`](docs/FORECAST.md)). The
investigation has a loader and a benchmark for CWRU bearing recordings and a
path from a recorded alarm to a case; no result is reported here for it yet with
the current scoring. No dataset ships in this repository or in the image
([`docs/DATA.md`](docs/DATA.md)).

**The machine's own normal.** A real machine's normal spectrum is not the
textbook's, and against a textbook machine its quirks read as a fault. Given
healthy captures of the same machine, a case is scored on the change from them
([`docs/DOMAIN.md`](docs/DOMAIN.md)). Tested on a synthetic rig built to have
that problem; not yet on recorded bearings.

---

## What is in here

| Path | What it is |
|---|---|
| `src/hypothesis_engine/physics/` | Fault frequencies, what each fault looks like, the synthesiser, the likelihood built by simulation, the machine's own normal |
| `src/hypothesis_engine/signals/` | Waveform to named physical observations; speed read from the signal |
| `src/hypothesis_engine/investigation/` | The loop, the one writer of beliefs, the measurement menu, the ledger, recorded runs as cases |
| `src/hypothesis_engine/tools/` | What a model may call on a case, and the one door a reading comes in by |
| `src/hypothesis_engine/agents/` | The investigator loop, its offline stand-in, the run told in plain words; optional narration |
| `src/hypothesis_engine/forecast/` | The watcher, the health percent, time left as a range |
| `src/hypothesis_engine/ticket/` | The repair ticket, every sentence checked against its evidence; the camera look |
| `src/hypothesis_engine/fleet/` | Lessons from closed cases, and signed updates a person installs |
| `src/hypothesis_engine/lens/` | A phone video read as motion and sound |
| `src/hypothesis_engine/data/` | The synthetic rig and pump life, loaders for recorded sets, the live sensor's buffer |
| `src/hypothesis_engine/api/` | The HTTP surface; it serialises engine state and decides nothing |
| `firmware/esp32_rig/` | The sensor sketch that posts to `/ingest` |
| `web/` | The five tabs (Vite + React) |
| `docs/` | Architecture, the physics, decisions with their reasons, data, deploy |

Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), then
[`docs/DOMAIN.md`](docs/DOMAIN.md) for the physics and
[`docs/DECISIONS.md`](docs/DECISIONS.md) for why each rule is there.

---

## The rules that keep this honest

1. **Physics decides, the model explains.** Beliefs move only through simulated
   likelihoods and measured evidence, in one function. A language model never
   edits one, and no tool would let it.
2. **"Unresolved" is an answer.** No verdict below 80%, and none while the
   capture holds something the leading suspect cannot explain. A machine whose
   vibration has doubled over its own normal is never called healthy.
3. **Every claim cites evidence.** If it is not in the ledger, it does not go in
   the conclusion or on the ticket.
4. **No invented numbers.** The constants that move a belief are listed in
   `docs/DOMAIN.md` with where each comes from, and marked when one is a
   judgement call or not yet calibrated.
5. **Safety stays human.** Crux recommends; a named person approves the ticket.
   Nothing here touches machine control.
6. **It runs with no keys.** CI has no secrets; if a change breaks the offline
   path, it breaks the build.

---

## Status, 8 October 2026

Working: the engine and its tests, the investigator loop with its offline
stand-in, the five tabs, the path from alarm to investigation to ticket, the
live-sensor route.

Not done: a run against the Gemini service (the loop has only met its
stand-in); a result for the investigation on recorded bearings; the hardware
rig end to end; a phone coach for taking the measurement (the written steps in
`investigation/catalog.py` stand in); a store that survives a restart.

## Licence

MIT © 2026 MechNova
