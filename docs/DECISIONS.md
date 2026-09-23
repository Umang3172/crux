# Decisions

Short records of choices that are expensive to reverse. Add one when you make a
call a teammate (or a judge) would otherwise question.

Format: context → decision → consequence.

---

## ADR-0001 · Analytical physics, no neural surrogate in v1
**23 Sep 2026**

**Context.** The original plan had a physics-informed neural surrogate so the
agent could test hypotheses quickly. Training one well takes weeks; training one
badly gives a confident wrong simulator under a nice UI, which is the failure
mode that kills this kind of product.

**Decision.** v1 is analytical fault frequencies plus a parametric signal
synthesiser. A surrogate only arrives if simulation time becomes the bottleneck,
which at ~5 ms per hypothesis it is not.

**Consequence.** The credibility layer is checkable by hand and needs no
training data. We cannot simulate load-dependent non-linear behaviour; when that
matters we will say so rather than extrapolate.

---

## ADR-0002 · The core runs with no API keys
**23 Sep 2026**

**Context.** Two model providers (Gemini, Jev), a hackathon network, three
laptops and a live demo.

**Decision.** Every model role has an offline implementation behind a Protocol
(`agents/protocols.py`). `GET /health` reports which is live. CI has no secrets.

**Consequence.** A key outage degrades the narration, never the diagnosis. The
cost: two implementations of each role, and the discipline to keep the offline
one working.

---

## ADR-0003 · The comparison includes the envelope spectrum
**23 Sep 2026**

**Context.** The first comparator correlated raw 0–500 Hz spectra. On an
outer-race signal it scored imbalance 0.99 and the outer race 1.00 — no
discrimination at all, because bearing impacts barely show in the raw low-frequency
spectrum.

**Decision.** `spectral_correlation` averages a raw-spectrum correlation and an
envelope-spectrum correlation (weight 0.5 each).

**Consequence.** The same case now scores outer race 1.00 against imbalance 0.49.
Bearing hypotheses are judged where bearing evidence lives. The weight is a
constant we expect to revisit once real rig data arrives.

---

## ADR-0004 · Beliefs move by an explicit likelihood, not by a model
**23 Sep 2026**

**Context.** It would be easy to let Gemini output posteriors directly.

**Decision.** Posterior ∝ prior × exp(`LIKELIHOOD_SHARPNESS` × correlation),
then a Gaussian likelihood per measured value. A language model never writes a
belief.

**Consequence.** Every number in a conclusion is reproducible from the ledger,
which is what makes the ledger worth anything. `LIKELIHOOD_SHARPNESS = 9` is a
calibration constant: change it in one place, with data, and record the result
here — never to make a demo pass.

---

## ADR-0005 · The coached measurement is a separate, droppable module
**23 Sep 2026**

**Context.** Gemini Robotics-ER 2 streaming is a preview API with a 1 fps video
limit. It is our differentiator and also our biggest technical risk.

**Decision.** The coach sits behind the `Gate` protocol and returns a value into
`apply_outcome()`. If it is not working by **5 October**, we ship the
investigator with a plain written instruction instead, and the rest of the system
is unaffected.

**Consequence.** One kill switch, one date, no renegotiation later.

---

## ADR-0006 · Repository is private until submission
**23 Sep 2026**

**Context.** The hackathon requires a public repo at submission; the build runs
in a competition.

**Decision.** Private now, flipped to public before the 18 October deadline.

**Consequence.** Someone has to remember to flip it. It is the first item in the
week-4 checklist in `docs/TASKS.md`.
