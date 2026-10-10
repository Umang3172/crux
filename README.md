# Hypothesis Engine

**An AI investigator that uses your technician as its best sensor.**

Team **MechNova** · Google Cloud AI Builder Cup 2026 · Theme 3, Manufacturing

Most machine-health tools tell you a machine is abnormal. Hypothesis Engine works
out *why*: it forms competing physical explanations, runs virtual experiments
against a physics model, kills the explanations that do not match the real
signal, and — when simulation cannot decide — asks a person for the single
cheapest measurement that would, coaching them through taking it correctly.

```
observe → hypothesise → virtual experiment → ask for evidence → conclude → verify → learn
```

---

## Quick start

```bash
# one-time
brew install uv            # or: pipx install uv
uv venv --python 3.11
uv pip install -e ".[dev]"

# see the whole loop, no API keys and no hardware needed
uv run hypengine demo --fault outer_race
uv run hypengine frequencies --rpm 1798

# the investigator agent: Gemini with credentials, an offline stand-in without
uv pip install -e ".[dev,llm]"
uv run hypengine investigate --fault rolling_element   # a fault the catalogue lacks

# the API a judge would open
uv run hypengine serve       # http://localhost:8080/docs
curl -s localhost:8080/replay -X POST -H 'content-type: application/json' \
  -d '{"fault":"looseness"}' | python -m json.tool | head -40

# tests
uv run pytest
```

**No keys are required.** Gemini and Jev are optional accelerators; without them
the system falls back to deterministic implementations and everything still runs
(`GET /health` tells you which are live).

---

## What is in here

| Path | What it is |
|---|---|
| `src/hypothesis_engine/physics/` | Fault frequencies, predicted signatures, the synthesiser, the comparator |
| `src/hypothesis_engine/signals/` | Waveform → named physical observations (no anomaly scores) |
| `src/hypothesis_engine/investigation/` | The loop, the belief update, the test catalogue, the ledger |
| `src/hypothesis_engine/tools/` | What a model may call on a case; no tool takes a probability, a score or a reading |
| `src/hypothesis_engine/agents/` | The investigator (Gemini drives a case through the tools; code ends the loop), narration and Jev checks, all optional |
| `src/hypothesis_engine/data/` | Bench-rig captures (synthetic for now) and the CWRU loader |
| `src/hypothesis_engine/api/` | FastAPI surface, including `/replay` for judges |
| `firmware/esp32_rig/` | ESP32 + accelerometer sketch that streams the real rig |
| `web/` | Investigation UI (Vite + React) |
| `docs/` | Architecture, the physics domain notes, decisions, tasks, hardware, demo script |

Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), then
[`docs/DOMAIN.md`](docs/DOMAIN.md) if you are touching the physics.

---

## The rules that keep this honest

1. **Physics decides, the model explains.** Beliefs move only through simulated
   likelihoods and measured evidence. A language model never edits a posterior.
2. **Every claim cites evidence.** If it is not in the ledger, it does not go in
   the conclusion.
3. **No invented numbers.** Prediction tables live in `investigation/catalog.py`
   and `physics/signatures.py`, are documented in `docs/DOMAIN.md`, and get
   recalibrated against the rig — they are never tuned to make a demo pass.
4. **Safety stays human.** The agent recommends; a person approves every
   physical action. Nothing here touches machine control.
5. **It runs with no keys.** CI has no secrets; if a change breaks the offline
   path, it breaks the build.

---

## Status

Week 1 of four. Working today: the physics core, the investigation loop, active
test selection, the evidence ledger, repair verification, the API and the replay
mode. Next: the real rig stream, the phone measurement coach, and the UI. See
[`docs/TASKS.md`](docs/TASKS.md).

## Licence

MIT © 2026 MechNova
