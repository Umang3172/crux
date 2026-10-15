# Working in this repo (for any coding agent)

Read this first.

## What this project is

Hypothesis Engine diagnoses rotating-machine faults by **running virtual
experiments and asking a human for the deciding measurement**. It is not a
classifier with a chat wrapper. If a change makes it behave like one, it is
wrong, however good the metric looks.

Team: MechNova. Deadline: **18 October 2026** (verify on the Hack2skill
dashboard). One submission, Theme 3.

## Non-negotiables

1. **The physics layer is deterministic.** No model weights, no network calls, no
   randomness outside an explicit `seed`. Anyone must be able to recompute a
   fault frequency by hand from `docs/DOMAIN.md`.
2. **A language model never moves a belief.** `agents/` may explain, translate,
   draft or classify a camera frame. Posterior updates happen only in
   `investigation/engine.py`, through simulated likelihoods and measured evidence.
   A model reaches a case only through `tools/`, whose functions never take a
   probability, a score or a reading (ADR-0007).
3. **The offline path must keep working.** No API keys in CI. If a model call
   site or `get_gate()` falls back, every test still passes.
4. **Every number has a source.** New constants go in `physics/signatures.py` or
   `investigation/catalog.py`, with a row in `docs/DOMAIN.md` explaining where
   they come from. Never tune a constant to make a demo pass — change the model
   or admit the limitation.
5. **Safety actions stay human.** Nothing in this repo sends a command to a
   machine. Recommendations only.

## Conventions

- Python 3.11, `uv` for everything: `uv pip install -e ".[dev]"`, `uv run pytest`.
- `ruff` is the formatter and linter: `uv run ruff check --fix . && uv run ruff format .`
- Types on every public function. Dataclasses for domain objects (`models.py`).
- Comments explain *why*, never *what*. The physics ones may be long; prose
  elsewhere should be short.
- Tests are the specification. A new fault, test or feature lands with a test
  that would fail without it.
- Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.

## Where things live

```
src/hypothesis_engine/
  models.py                 domain types, FaultKind, Evidence, InvestigationState
  physics/frequencies.py    BPFO/BPFI/BSF/FTF from geometry — verified against CWRU
  physics/signatures.py     what each hypothesis predicts (tones + impact trains)
  physics/synth.py          Signature -> waveform (the virtual experiment)
  physics/likelihood.py     how well each hypothesis explains a capture, by simulation
  physics/normal.py         the machine's own healthy captures: a case scored on the change from them
  physics/compare.py        simulated vs real correlation, for the picture only
  signals/features.py       waveform -> named observations, envelope analysis
  investigation/catalog.py  the measurements the agent can ask for, and their costs
  investigation/engine.py   the loop: observe, experiment, choose a test, conclude
  investigation/recorded.py a recorded run as a case: its early recordings are its normal, later ones answer checks
  tools/                    what a model may call on a case, and the door readings come in by
  agents/investigator.py    the investigator loop: Gemini drives the tools, code ends it
  agents/scripted.py        the offline stand-in the loop runs on without credentials
  agents/                   other optional model adapters + offline fallbacks
  data/rig.py               synthetic bench-rig captures and the answering oracle
  data/cwru.py              real bearing recordings
  api/app.py                FastAPI, including /replay
  series/                   the Trends tab: TimesFM 3.0, ARIMA_PLUS and contribution analysis in BigQuery on sensor history, served from snapshots (docs/SERIES.md)
```

## Common tasks

**Add a fault hypothesis**: `FaultKind` → `predicted_signature()` (the running
tones plus what the fault adds) → a prediction for it in the two tests a person
reports in `catalog.py` → a row in `docs/DOMAIN.md` → a case in
`tests/test_investigation.py`. A suspect for one case only does not
need any of that: write it as an `OrderSuspect` and pass it to
`Investigation.add_hypothesis`, which simulates and scores it (ADR-0010).

**Add a measurement the agent can request**: an `EvidenceTest` in `catalog.py`
with `sigma`, `effort_min` and the coaching `procedure`. If a capture answers it,
give it `capture_s` and a feature `physics.likelihood.capture_features` returns:
the engine simulates what every hypothesis reads, and no table is typed
(ADR-0013). If a person reports the value, give it a prediction table and teach
the rig oracle to answer it.

**Change how beliefs move**: only in `engine.py` (`_recompute` is the one
writer) and `physics/likelihood.py`, and say why in `docs/DECISIONS.md`.
`MODEL_MISMATCH` is an assumption awaiting calibration on recordings, not a
tuning knob for demos.

**Run the investigator**: `uv sync --extra dev --extra llm`, then
`uv run hypengine investigate --fault inner_race --severity 0.5 --noise 0.45`.
With no credentials it runs the scripted investigator; with Google Cloud's login
(`GOOGLE_GENAI_USE_ENTERPRISE=true`, `GOOGLE_CLOUD_PROJECT`) or `GOOGLE_API_KEY`
it runs Gemini. The first line it prints says which (ADR-0011).
`--fault rolling_element` or `--fault unlisted_impact` induces a fault the
catalogue does not list, to watch the investigator notice it (ADR-0012).

## What to check before you push

```bash
uv run ruff check . && uv run pytest
uv run hypengine demo --fault misalignment   # the loop still tells a story
```

The demo output is the product. If the transcript stops reading like an
investigation, something regressed even if the tests are green.
