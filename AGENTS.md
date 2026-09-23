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
   `investigation/engine.py`, through spectral correlation and measured evidence.
3. **The offline path must keep working.** No API keys in CI. If `get_narrator()`
   or `get_gate()` falls back, every test still passes.
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
  physics/compare.py        simulated vs real, log peak-hold spectral correlation
  signals/features.py       waveform -> named observations, envelope analysis
  investigation/catalog.py  the measurements the agent can ask for, and their costs
  investigation/engine.py   the loop: observe, experiment, choose a test, conclude
  agents/                   optional model adapters + offline fallbacks
  data/rig.py               synthetic bench-rig captures and the answering oracle
  data/cwru.py              real bearing recordings
  api/app.py                FastAPI, including /replay
```

## Common tasks

**Add a fault hypothesis**: `FaultKind` → `predicted_signature()` →
predictions for it in every test in `catalog.py` → a row in `docs/DOMAIN.md` →
a case in `tests/test_investigation.py`.

**Add a measurement the agent can request**: an `EvidenceTest` in `catalog.py`
with its predictions, `sigma`, `effort_min`, and the coaching `procedure`; then
teach `measure_from_capture()` or the rig oracle how to answer it.

**Change how beliefs move**: only in `engine.py`, and say why in
`docs/DECISIONS.md`. `LIKELIHOOD_SHARPNESS` is a calibration constant, not a
tuning knob for demos.

## What to check before you push

```bash
uv run ruff check . && uv run pytest
uv run hypengine demo --fault misalignment   # the loop still tells a story
```

The demo output is the product. If the transcript stops reading like an
investigation, something regressed even if the tests are green.
