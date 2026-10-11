# Open work

As of 10 October 2026. Three people, no lanes: anyone picks up any unchecked
item. Put your name on an item before you start it, so two people never build
the same thing. What is built is in the README; this file lists what is not.

## Before the submission on 18 October

- [ ] **One real run against Gemini.** Nothing here has called the service yet.
      With credentials set: `uv run hypengine gemini-check`, then one case on the
      Investigator tab, then one report on a closed case. If the report's
      explanation is poor, `CRUX_REPORT_MODEL=off` keeps the engine's own lines.
- [ ] **A result for the investigation on recorded bearings.** A person runs
      `uv run python scripts/fetch_cwru.py`, then `uv run hypengine benchmark`
      and `uv run hypengine benchmark --textbook`. Quote from the result files,
      with their commit (`docs/DATA.md`).
- [ ] **Deploy to Cloud Run** from the Dockerfile and open every tab on the link
      (`docs/DEPLOY.md`). The image has not been built.
- [ ] Flip the repository to public (ADR-0006).
- [ ] Record the three-minute video, plus a full backup take
      (`docs/DEMO_SCRIPT.md`).
- [ ] Deck: every number in it comes from a result file or a test, with the
      commit that produced it.

## Not built

- [ ] **The hardware rig, end to end.** `/ingest` has its server side and tests
      that post what the firmware posts; it has not met the hardware.
- [ ] **A coach for taking a measurement** (ADR-0005). The written steps in
      `investigation/catalog.py` stand in. The gate adapters in `agents/` are
      called by nothing, and how a typed-decision model compares with a general
      one on the same decisions has not been measured.
- [ ] **A case store that survives a restart.** Cases, notes and reports are in
      memory, per instance.
- [ ] **Measured values for the two typed tables.** What each fault predicts
      for a housing temperature and a coast-down is a first-pass table
      (`docs/DOMAIN.md`). A verdict that uses one says so. Replace them with
      values measured on a machine, or drop the two tests.

## Built, and not yet tried on the real thing

- [ ] Scoring against a machine's own normal, on recorded bearings (ADR-0015).
- [ ] The repair check, on a real repair (ADR-0024).
- [ ] The check on a model's sentences, with Gemini writing them (ADR-0021).
- [ ] An order typed into a note, with a real model reading it (ADR-0025).
- [ ] The two agents, the document look-up and the rewrite loop, with Gemini
      (ADR-0028 to ADR-0030). A real manual in place of the demo document.
- [ ] The hazard words, on notes written by technicians (`docs/DOMAIN.md`).

---

## Definition of done, per item

1. A test that would fail without the change.
2. `uv run pytest` and `uv run ruff check .` clean.
3. `uv run hypengine demo` still reads like an investigation.
4. If it changed a number: a row in `docs/DOMAIN.md`, or an ADR.
