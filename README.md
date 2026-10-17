# Crux

**The one measurement that decides.** An investigator for faults in rotating machines.

[![CI](https://github.com/Umang3172/crux/actions/workflows/ci.yml/badge.svg)](https://github.com/Umang3172/crux/actions/workflows/ci.yml)
· Team **MechNova** · Google Cloud AI Builder Cup 2026 · Theme 3, Manufacturing

**Live:** <https://hypothesis-engine-errupcwbra-el.a.run.app> (Cloud Run, asia-south1; no sign-in)

Most machine-health tools say a machine is abnormal. Crux works out *why*. It
holds competing physical explanations, simulates the vibration each one would
produce on this machine at this speed, and scores the real capture against all
of them. When the capture cannot decide, it asks a person for the single
measurement worth the most per minute of their time, and says what each
suspect expects it to read. Below 80% belief, or while the signal holds
something no suspect explains, it names no cause: it says "unresolved", and why.

It is not a classifier. There is no path from features to a label.

```
watch → alarm → simulate every suspect → ask for one check → verdict, or "unresolved" → work order → a person approves
```

---

## What Gemini does here, and what it cannot

Two Gemini agents work a case through the physics tools, in a loop built on the
Agent Development Kit (`agents/investigator.py`). The **investigator** reads the
evidence, asks the physics which measurement to request, narrates for the
maintenance team and closes the case. The **critic** is called only when
something in the capture is explained by no suspect: it compares it with the
bearing's own frequencies, looks in the machine's documents and its earlier
cases, and may write a new suspect as the vibration it would make. The physics
simulates that suspect and scores it on all the evidence, like any other. The
tools are split, so the agent that can close a case cannot write a suspect, and
the reverse.

No tool takes a probability, a score or a reading from a model, so a model
cannot set a belief. Plain code decides when the loop stops. If Gemini cannot be
reached, an offline stand-in finishes the case with the same tools and the
screen says so.

A closed case is written up the same way: the verdict, the reason, the action
and what would change it are the engine's own lines. Gemini may add an
explanation, and each of its sentences is kept only if every number and every
named cause in it is in the evidence it cites; a sentence that fails is shown
with the reason. Gemini also drafts work orders, turns what a repair found into
a lesson, and looks at a camera still or a phone video for visible trouble.
What a vision model sees is shown as unconfirmed and never reaches an
investigation.

---

## Built on Google Cloud

| Job | Google service |
|---|---|
| The app (UI and API on one origin) | **Cloud Run**, built by **Cloud Build** into **Artifact Registry** |
| Investigator, critic, explanation, work orders, lessons | **Gemini 3.8 Flash on Vertex AI**, through the service's own Google Cloud login (no key) |
| Camera still and phone-video look | **Gemini 3 Flash**, with code execution on so it can crop and zoom into a still |
| Forecasts and unusual readings on sensor history | **TimesFM 3.0** in BigQuery (`AI.FORECAST`, `AI.DETECT_ANOMALIES`), scored again with `AI.EVALUATE` |
| What changed against a normal week | BigQuery ML **contribution analysis** |
| A signal split into its parts, for the summary | BigQuery ML **ARIMA_PLUS** with `ML.EXPLAIN_FORECAST` |
| "Ask the data" in plain words | **Conversational Analytics API** (Gemini data agent over the BigQuery tables) |
| Lessons, the time-left model, camera stills, phone scans | **Cloud Storage** bucket mounted as the app's data folder |
| The learning hub's signing key | **Secret Manager** |

Commands and settings: [`docs/DEPLOY.md`](docs/DEPLOY.md). The Trends models and
their benchmark: [`docs/SERIES.md`](docs/SERIES.md).

---

## The app

Five sections across the top, each with its pages as tabs.

| Section | Pages | What it shows |
|---|---|---|
| **Machines** | Overview, Control room | Every machine on a demo plant and where it stands; bearing lives replayed with the alarm and time left as a range |
| **Investigations** | Investigations | One case at a time: the reading, every suspect tested on a virtual copy, the one check, the answer, the ledger behind it, the check after a repair |
| **Work** | To do, Sign-offs, Work orders, Phone scans | What each person has to do next; work orders a named person approves; a phone video read as motion and sound |
| **Insights** | Trends, Track record, Lessons | Google's forecasts on a compressor's history; how often each method was right, beside the baselines it beat; lessons from closed cases |
| **How it works** | Overview, The AI at work, Anatomy, System | The loop in plain words; an investigation replayed call by call, model beside physics; the machines drawn from the engine's numbers |

### A phone scan can be the deciding measurement

When a case asks for a check, the person can answer it with a ten-second phone
video of the machine (**Use a phone scan** on the case). The phone's
microphone answers the envelope check (bearing impacts in the 1.5 to 5 kHz
band) and its camera the two checks that read a ratio of shaft lines;
temperature and the coast-down are refused, with the reason. The reading enters
through the same door as any other, carrying an uncertainty worked out from the
clip, so a phone moves the beliefs less than a sensor would
([`lens/answer.py`](src/hypothesis_engine/lens/answer.py), ADR-0033).

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

# the app on http://localhost:8080
make web-build
make serve-app

# checks CI runs
uv run ruff check . && uv run ruff format --check . && uv run pytest
```

**No keys are required.** Without them the investigator runs its offline
stand-in and every number is the same; `GET /health` and the page footer say
which models are live. Gemini is reached through Google Cloud's own login or an
API key (`.env.example`).

---

## What is measured, and what is not

**The diagnosis, on synthetic cases.** `uv run hypengine evaluate` runs 180
hard cases (three faults, three strengths, four noise levels, five seeds). A
requested measurement is answered by a new capture of the same machine in the
same state.

| | Right | Says it cannot tell | Wrong |
|---|---|---|---|
| Crux | 130 | 50 | 0 |
| Naming the best spectral match | 140 | never | 40 |

The second row is the simplest thing that always answers. Crux gives up ten
right answers and forty wrong ones for fifty times it says it cannot tell. The
cases are made by the same signal model the engine simulates with, so this
shows the decision rule working; it proves nothing about a real machine.

**When to fix, on real run-to-failure bearings** ([`docs/FORECAST.md`](docs/FORECAST.md)).
On the XJTU-SY test set the watcher fired before failure on 14 of 15 bearings
(the miss is a cage failure). The shipped time-left model's 80% range held the
truth 80% of the time on held-out bearings from the same lab, and 65% on NASA
IMS bearings it never saw.

**Trends, on a real compressor** ([`docs/SERIES.md`](docs/SERIES.md)). On every
day of the MetroPT-3 record, TimesFM 3.0's next-day forecast missed 39% less
than repeating yesterday (9.3 against 15.1 points of loaded share). Crux's own
watcher caught all four reported air leaks at 2.6 false alarms a month; none of
the four detectors warns a day ahead.

**Not yet measured:** the diagnosis on recorded bearings (the CWRU benchmark is
built and has not been run on the files, [`docs/DATA.md`](docs/DATA.md)), and
the phone scan on real phone recordings of a machine with a known fault. No
dataset ships in this repository or in the image.

---

## What is in here

| Path | What it is |
|---|---|
| `src/hypothesis_engine/physics/` | Fault frequencies, what each fault looks like, the synthesiser, the likelihood built by simulation, the machine's own normal |
| `src/hypothesis_engine/signals/` | Waveform to named physical observations; speed read from the signal |
| `src/hypothesis_engine/investigation/` | The loop, the one writer of beliefs, the measurement menu, the ledger, recorded runs as cases |
| `src/hypothesis_engine/tools/` | What a model may call on a case, and the one door a reading comes in by |
| `src/hypothesis_engine/agents/` | The investigator and critic loop, its offline stand-in, the report and the check on a model's sentences, the Gemini preflight |
| `src/hypothesis_engine/forecast/` | The watcher, the health percent, time left as a range |
| `src/hypothesis_engine/series/` | Trends: BigQuery jobs, saved views, the benchmark, Ask the data |
| `src/hypothesis_engine/ticket/` | The work order, every sentence checked against its evidence; the camera look |
| `src/hypothesis_engine/fleet/` | Lessons from closed cases, and signed updates a person installs |
| `src/hypothesis_engine/lens/` | A phone video read as motion and sound, and as the answer to a case's check |
| `src/hypothesis_engine/data/` | The synthetic rig and pump life, loaders for recorded sets, the live sensor's buffer |
| `src/hypothesis_engine/api/` | The HTTP surface; it serialises engine state and decides nothing |
| `firmware/esp32_rig/` | The sensor sketch that posts to `/ingest` |
| `web/` | The app (Vite, React, TypeScript) |
| `docs/` | Architecture, the physics, decisions with their reasons, data, deploy |

Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), then
[`docs/DOMAIN.md`](docs/DOMAIN.md) for the physics and every constant's source,
and [`docs/DECISIONS.md`](docs/DECISIONS.md) for why each rule is there.

---

## The rules that keep this honest

1. **Physics decides, the model explains.** Beliefs move only through simulated
   likelihoods and measured evidence, in one function. A language model never
   edits one, and no tool would let it.
2. **"Unresolved" is an answer.** No verdict below 80%, and none while the
   capture holds something the leading suspect cannot explain. A machine whose
   vibration has doubled over its own normal is never called healthy.
3. **Every claim cites evidence.** If it is not in the ledger, it does not go in
   the conclusion or on the work order.
4. **No invented numbers.** The constants that move a belief are listed in
   `docs/DOMAIN.md` with where each comes from, and marked when one is a
   judgement call or not yet calibrated.
5. **Safety stays human.** Crux recommends; a named person approves the work
   order. Nothing here touches machine control.
6. **It runs with no keys.** CI has no secrets; if a change breaks the offline
   path, it breaks the build.

---

## Known limits

- **Gemini and a fault the list lacks.** On the deployed service the Gemini
  investigator has concluded a replayed outer-race case on its own (three tool
  calls, 13 Oct 2026). On a fault the catalogue lacks it has so far ended
  unresolved; the offline stand-in concludes that case through the critic.
- **Cases live in memory.** The service runs one instance so every request sees
  the same cases; a restart starts empty. A store that survives a restart is
  not built.
- **The measurement coach is written steps.** A phone that coaches a person
  through the measurement live is not built; each check carries its procedure.
- **The hardware rig end to end** (sensor to `/ingest` to a case) is built and
  tested in software, not shown on a running rig.

## Licence

MIT © 2026 MechNova
