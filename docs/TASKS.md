# Plan to 18 October

Three people, no lanes: anyone picks up any unchecked item. Put your name on
an item before you start it, so two people never build the same thing.

---

## Week 1 · 23–28 Sep · Foundations

- [x] Physics core: fault frequencies verified against CWRU published multipliers
- [x] Predicted signatures for five faults + parametric synthesiser
- [x] Raw + envelope comparison (ADR-0003)
- [x] Investigation loop, belief update, evidence ledger
- [x] Active test selection by expected information gain per minute
- [x] Repair verification against the predicted improvement
- [x] FastAPI surface with `/replay`, CLI demo, 33 tests, CI
- [ ] Order rig parts; build the rig; stream real vibration into `Observation`
- [ ] Gemini narrator live (`GOOGLE_API_KEY`), compare its explanations with the template
- [ ] Cloud Run deploy from the Dockerfile; URL in the README

## Week 2 · 29 Sep–5 Oct · The core loop, and the kill switch

- [ ] Induce all four rig faults, three runs each; **recalibrate** the
      prediction tables in `catalog.py` from measured data (see DOMAIN.md)
- [ ] Run the investigator over held-out CWRU files; record accuracy
- [ ] Measurement coach — ER 2 streaming watches placement, Jev returns the
      per-second verdict, the accepted capture posts back as evidence
- [ ] Jev vs Gemini Flash benchmark on the same gate decisions (latency, cost)
- [ ] Investigation UI: hypothesis constellation, real vs simulated, ledger
- [ ] **5 Oct · KILL SWITCH** (ADR-0005): if the coached measurement does not close
      the loop end to end, drop to a written instruction and move on. Decide on
      the day.

## Week 3 · 6–12 Oct · Evidence, trust, proof

- [ ] Lesson memory — confirmed cases become priors for the next case
- [ ] Twelve logged investigations across faults and severities
- [ ] "What would change my mind" written by Gemini from the ledger
- [ ] Safety gate — a conclusion that recommends a shutdown needs sign-off
- [ ] Replay mode polished enough for a judge with only the link
- [ ] Hardware failure drill — unplug the rig mid-demo and recover

## Week 4 · 13–18 Oct · Ship

- [ ] Flip the repo to public (ADR-0006)
- [ ] Record the 3-minute video, plus a full backup take
- [ ] Deck final; numbers in it come from the logs, not from memory
- [ ] Deployed URL, public repo, deck and video submitted — **do not wait for the
      last day**; confirm the real deadline on the Hack2skill dashboard

---

## Definition of done, per item

1. A test that would fail without the change.
2. `uv run pytest` and `uv run ruff check .` clean.
3. `uv run hypengine demo` still reads like an investigation.
4. If it changed a number: a row in `docs/DOMAIN.md`, or an ADR.
