# Contributing

Three of us, twenty-five days, one submission. Optimise for not blocking each
other.

## Setup

```bash
brew install uv          # or pipx install uv
make setup               # venv + dev install
make test                # 30+ tests, no keys needed
make demo                # the whole loop, end to end
```

Optional model adapters: `uv pip install -e ".[llm]"` plus a `.env` copied
from `.env.example`.

## Branches and commits

- `main` is always green and always demoable.
- Branch per task: `a/rig-ingest`, `b/coach-gate`, `c/investigation-ui`.
- Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
- Open a PR even for small things; the template asks the questions that matter.

## Before you push

```bash
uv run ruff check --fix . && uv run ruff format .
uv run pytest
uv run hypengine demo --fault misalignment
```

If the demo transcript stops reading like an investigation, treat it as a
failure even when the tests are green.

## Review, in one line

Does this keep the physics deterministic, the beliefs explainable, and the
offline path working? If yes, ship it.

## Things that need an ADR

Changing how beliefs move, adding a model into the decision path, changing the
fault set, or anything that makes an API key necessary to run. Add a short entry
to `docs/DECISIONS.md` in the same PR.
