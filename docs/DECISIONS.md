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

---

## ADR-0011 · The investigator is a graph workflow that code ends
**3 Oct 2026**

**Context.** A language model is to drive investigations through the tools
(ADR-0007). Left to itself, a model decides when it is done, and models are
better at calling tools than at deciding when to call them. The agent framework
in use (ADK 2) deprecates its loop agent in favour of graph workflows.

**Decision.** `agents/investigator.py` builds an ADK graph `Workflow`: the
investigator (`LlmAgent`, whose only tools are `InvestigatorTools`, each returning
plain JSON), then `gate`, a plain function that routes back to the investigator
while the case is open, no reading is out and rounds remain, then `finish`, a
plain function that closes a case the rounds ran out on by the engine's own rule.
No tool ends the loop. The model is Gemini when credentials are present (Google
Cloud's own login preferred, an API key accepted; `GEMINI_MODEL`, default
`gemini-3.8-flash`), and otherwise `agents/scripted.py`, a fixed policy over the
same tools. Tests drive the loop with the scripted model, so it runs in CI with
no network. A run is also capped in model calls and in seconds
(`MAX_MODEL_CALLS`, `MAX_SECONDS`); one that hits either cap is closed by the same
rule as one that spends its rounds, so a model that loops or stalls cannot hold a
case open or run up a bill.

**Consequence.** The model chooses the next step and the words; code chooses when
to stop and what a verdict needs. An argument a tool does not declare is dropped
before the tool runs (`tests/test_agent_loop.py`). The agent framework stays the
optional `llm` extra: without it the core and its tests run, and the agent tests
skip.

---

## ADR-0012 · An impact no suspect predicts stops the case at any belief
**3 Oct 2026** · extends ADR-0009

**Context.** ADR-0009 blocks a verdict over a strong periodic impact the leader
does not predict, but checks only once the leader reaches the bar. Below it the
engine kept asking for measurements. On a capture with impacts at 7.6x shaft
speed, which nothing in the catalogue predicts, the list led with "healthy" at
39 % and the engine asked a technician for a reading. The reading could only
move belief among causes that all leave the impacts out, so no answer could have
led to a verdict. And the investigator had nothing to go on when writing the
missing suspect.

**Decision.** `Investigation.blocking_gap()` first looks for the strongest
envelope line that no hypothesis on the list predicts. If it is stronger than
everything the list does explain, it blocks a verdict at any belief, because it
would block whichever of those hypotheses came to lead: it is unexplained by
each of them, and stronger than anything each one explains. The engine then
closes the case as unresolved instead of requesting a reading, and
`choose_next_test` in the tool layer refuses. A line only the leader leaves out
still blocks once the leader reaches the bar. A new tool,
`bearing_frequency_matches`, compares the blocking line with the bearing's own
frequencies and names the part each points to (`docs/DOMAIN.md`). The offline
investigator writes a suspect only where that points to a rolling element or the
cage, and otherwise closes the case with the line as the clue. Open-ended
suspects are Gemini's to write. The replay rig gains two faults the catalogue
does not list, `rolling_element` and `unlisted_impact`, so the path can be shown
from the deployed link. Every suspect the physics refuses is now written to the
ledger with the reason, including one with a line the capture cannot contain;
that check moved from the tool layer into `add_hypothesis`, so every caller gets
it.

**Consequence.** No technician time goes on a reading that cannot change the
outcome. On a spalled rolling element the closed list leads with the wrong cause
(healthy at 94 % on the replay capture) and is refused. The investigator matches
the line to 2xBSF and writes the suspect, the physics tests it, and the case
concludes on it at >99 % with "inspect before repair". Across 96 catalogue
captures (six faults, three severities, two noise levels, three seeds) no line
cleared the check, so no catalogue case changed. Still to check on recordings:
how often the check fires on healthy machines (the caveat in ADR-0009).

---

## ADR-0013 · What a requested measurement will read is simulated, at one severity for all the evidence
**5 Oct 2026** · extends ADR-0008; replaces the capture rows of the catalogue's prediction table

**Context.** The measurement catalogue held one hand-typed prediction per fault
for each test: for the envelope test, +1.20 for an outer-race fault and −0.90 for
an inner-race one, whatever the fault's severity or the capture's noise. The
replay rig answered a request from a clean, full-strength copy of the true
fault, so the table was never held against an honest answer. Simulating one
shows what it is: for an outer-race fault at severity 0.35 in noise 0.45, a
second two-second capture reads +0.09, and the thirty-second capture the test
asks for reads +0.43. Against the table, both sit nearer "not a bearing fault"
(0.00) than "outer race" (+1.20), so an honest measurement would have moved
belief away from the true cause. The chooser also bought the best test per
minute even when no answer could change anything.

**Decision.**
- A test answered by a capture declares its length (`capture_s`) and carries no
  table. What each hypothesis predicts it reads is simulated at that length, at
  the capture's noise and at every severity (`physics.likelihood.predict_reading`),
  and read by the same feature extraction as a real capture. A capture handed
  over whole (`Investigation.apply_capture`) is scored at its own length and noise.
- The evidence is kept per severity and averaged once: a hypothesis cannot be a
  mild fault for the first capture and a severe one for the reading that follows.
- The two tests a person reports keep a table. It describes a full-strength
  fault; a milder one is taken to read proportionally closer to a healthy
  machine. An assumption, stated in `docs/DOMAIN.md`.
- A test is offered only when some imagined answer would bring a hypothesis to
  the bar and the two leaders are expected to read at least `DISTINCT_SIGMA`
  apart. `TestChoice` carries what each hypothesis is expected to read, the
  allowance, the pair it separates and the chance of settling the case.
- The replay rig answers from a new capture of the same machine in the same
  state, as long as the test asks for. A reading nobody can take is recorded,
  costs nothing, and the next most useful test is asked for.
- The real-data benchmark answers a requested capture from the stretch of the
  recording after the one the case was opened on.

**Consequence.** On the synthetic rig with honest answers: of 63 cases (six
faults, severities 0.25 to 1.0, three noise levels) 55 end in a verdict and 8
unresolved, and 16 ask for a measurement. A moderate fault under heavy noise is
settled by one or two requested measurements. A faint one (severity 0.35 at
noise 0.45) ends unresolved; the old table and the full-strength answer had made
it look settled. Choosing a test now costs one to two seconds of simulation, and
the test suite about a minute. Each test's `sigma` is still a typed allowance,
to be calibrated on recordings. The benchmark's answering stretch is seconds
long where the test asks for thirty, so it settles less than a real capture
would. Nothing here has been run on real recordings.

---

## ADR-0014 · A fault adds to the running tones, and a healthy verdict states its detection limit
**5 Oct 2026** · corrects a claim in ADR-0008

**Context.** Running the engine across mild faults in noise found 4 confident
wrong verdicts in 63 cases: mild imbalance called healthy at 81 to 86 %, and a
faint outer-race fault called inner race at 88 %. Two modelling flaws were behind
them. The bearing-fault signatures carried the 1x running tone but dropped the
normal 2x, against the model's own rule that a fault leaves the running tones in
place; a missing 2x then counted as evidence against "healthy", and so did the
work of telling a faint bearing fault from a healthy machine. And a line's height
is read against the floor around it, which near 1x in a two-second capture was
the median of 28 bins: that median scatters by 0.08 in log10, enough to hide a
1x tone at twice its normal height. The independent test machine of ADR-0008
shared the first flaw, which is why it did not show.

**Decision.** Every fault signature, and every written suspect, carries the
running 1x and 2x (`BASELINE_1X`, `BASELINE_2X`) and adds its fault to them. The
floor around a line is the median of at least `FLOOR_MIN_BINS` (160) bins, which
brings its scatter to 0.03. A faint fault can still look exactly like a healthy
machine in a short, noisy capture, and no rule can know otherwise, so a healthy
verdict now says what it could not have seen: every fault that, at the mildest
severity simulated, fits the evidence nearly as well as healthy does
(`Investigation.cannot_exclude`).

**Consequence.** The same 63 cases now give one such verdict, not four: a faint
outer-race fault (severity 0.25, noise 0.25) called healthy at 88 %, with "outer
race at severity 0.25 cannot be excluded" in its reasoning. Across 180 further
cases answered honestly (outer race, inner race and imbalance at severities 0.35
to 0.75, four noise levels, five seeds) no verdict was wrong: 129 ended correct
and 51 unresolved. The promise of ADR-0008 is restated as two, and tested on
the independent machine: a fault is never named at the bar unless it is the true
one, and a healthy verdict on a faulty machine names the true fault among those
it cannot exclude (one of 54 captures there). With the running tones in place, a
bent shaft written as "strong 1x, some 2x" is refused as a twin of heavy
imbalance, which is what a spectrum alone can say. Still open: the signature
amplitudes are in the model's own units, tied to the capture only through its
noise level, so on a real sensor the predicted heights rest on an assumed
tone-to-noise ratio until a machine's own baseline calibrates them.

