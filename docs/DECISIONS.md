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

---

## ADR-0007 · A model can read beliefs but has no way to write one
**3 Oct 2026**

**Context.** A language model is going to drive investigations by calling tools.
If any tool accepted a probability, a score or a measured value, the model could
move a belief by writing a number, and text pasted into a case, such as a
technician's note, could steer it there.

**Decision.** `tools/` has two doors. `InvestigatorTools` is what a model may
call: read the case, run the virtual experiments once, ask the physics which
measurement to buy and request exactly that one, propose a suspect the catalogue
lacks, narrate, and ask to conclude or to close the case as unresolved. None of
those functions takes a probability, a score or a reading, and
`tests/test_tools.py` fails if one ever does. Readings come in only through
`record_measurement`, which a technician, a sensor or the replay rig calls.
`conclude` is refused whenever the engine would refuse it (ADR-0009). A written
suspect carries physics only and is simulated by the engine (ADR-0010). A
model's narration is stored apart from the evidence ledger.

**Consequence.** A model can be wrong in what it says, but not in what the engine
believes. The cost: the model cannot choose its own measurement or re-run an
experiment. When it disagrees with the physics, its moves are to propose a
suspect or to close the case as unresolved.

---

## ADR-0008 · Beliefs move by a likelihood built from simulation
**3 Oct 2026** · supersedes the scoring in ADR-0003 and `LIKELIHOOD_SHARPNESS` in ADR-0004

**Context.** The first look scored each hypothesis by a spectral correlation
and moved belief by exp(9 × correlation). On a healthy capture it ranked outer
race 0.546 above healthy 0.499; on an imbalance capture, outer race 0.566 above
imbalance 0.500. The envelope correlation was 0.000 for every non-bearing
hypothesis, so half of each score was decided by noise: a correlation cannot
credit a hypothesis for predicting that a peak is absent. The sharpness 9 had no
source.

**Decision.** `physics/likelihood.py` measures every line the hypotheses predict,
simulates each hypothesis at five severities and four seeds at the capture's own
speed and noise, and scores the capture with a robust Student-t per line,
averaged over severity. The constants and their sources are in
`docs/DOMAIN.md`. The correlation is still computed for the picture in the UI;
it no longer moves a belief.

**Consequence.** Healthy and imbalance captures now lead correctly, and a
hand-built model of the machine that the simulator did not generate
(`tests/test_likelihood.py`) is never called confidently wrong across six faults,
three severities and three seeds. The first look costs about a quarter of a
second. `MODEL_MISMATCH` is an assumption until it is calibrated on recordings
the results are not reported on.

---

## ADR-0009 · "Unresolved" is an answer
**3 Oct 2026**

**Context.** `run()` concluded after its measurement budget whatever the belief
(observed at 51 % against an 80 % bar), and a fault outside the list was always
reported as its nearest neighbour. A wrong verdict costs a maintenance team more
than "we could not tell, and here is why".

**Decision.** There is no verdict below `CONCLUDE_ABOVE`. There is none while the
capture holds a periodic impact the leader does not predict that is stronger than
anything the leader explains, and none after a reading that fits no hypothesis
within 4 σ. Such a case ends with outcome `unresolved` and the reason, through
`Investigation.finish()`. The API reports `outcome` and `unresolved_reason`; the
benchmark counts unresolved cases separately and gives accuracy over the
verdicts actually given.

**Consequence.** The product can say "I don't know", for a reason a person can
check. Coverage becomes a number to report beside accuracy.

---

## ADR-0010 · A written suspect is tested by the same physics
**3 Oct 2026**

**Context.** "I don't know" is honest but not the end: someone, a technician or a
language model, will propose the cause the catalogue lacks. If that suspect
entered with a belief someone typed, or with predictions someone made up, it
would move beliefs without physics.

**Decision.** A written suspect is an `OrderSuspect`: tones and impact trains in
multiples of shaft speed, heights relative to the running 1x, and nothing else.
`Investigation.add_hypothesis` simulates it like a catalogue hypothesis and
scores it on all the evidence so far: the first capture, re-scored for every
hypothesis on the lines the newcomer adds, and each reading taken (it predicts
none of the catalogue's features, so each counts flat for it). Beliefs are kept
as log-evidence per hypothesis, so the result is the same whatever order the
suspect and the readings arrive in. A suspect that differs from an existing
hypothesis by less than one sigma on every line, at every severity, is refused:
no capture could tell them apart.

**Consequence.** A suspect wins only by explaining the capture better, and a wrong
one is visibly rejected by the simulation. A verdict on a written suspect says it
is not a catalogue cause and recommends inspection before repair. The tool
layer's `propose_suspect` (ADR-0007) now reaches the physics directly.
