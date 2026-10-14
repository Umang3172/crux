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


## ADR-0015 · With healthy captures of the machine, a case is scored on the change from its own normal

**Context.** ADR-0014 left one thing open: signature amplitudes are in the
model's own units, and the model's healthy machine is a textbook one, a 1x tone
with a quarter of it at 2x. A real machine has its own normal spectrum. To see
what that costs, a rig was built in `tests/test_own_normal.py` whose normal is
not the textbook's: a 2x taller than its 1x, harmonics to 4x, noise that is
quiet near the shaft lines and loud above 1 kHz. Scored against the textbook,
that rig healthy read as misaligned at 0.95 or more, and so did the same rig
with an imbalance or an inner-race fault. Its quirks were being scored as its
diagnosis. A watcher on the same machine already knows what its normal looks
like; the engine did not use it.

**Decision.** `Investigation` takes `normal`: healthy captures of the same
machine. With them, every measurement is restated before it is scored
(`physics/normal.py`), in two steps. *Units*: the simulator's noise is set so
its textbook 1x stands as far above the floor as the machine's healthy 1x, so
the model's unit is the machine's own running tone. *Quirks*: each line's tone
is taken as its amplitude above the noise, and what the machine has gained
there since it was healthy is added to the textbook healthy machine. The
scoring itself is unchanged. Amplitudes are added, not heights: on a rig whose
2x is already tall, a misalignment is a small step in height and a large one in
amplitude, and scored as a step in height the same capture read as imbalance.
Healthy captures are first restated at today's noise floor; with several, the
spread of their own restated lines widens every prediction; periodic impacts
they already contain count as explained; a requested capture is restated the
same way. A healthy verdict is refused once the overall level has doubled
(`LEVEL_RISE`): nothing on the list explains that, and neither does a healthy
machine. A recorded run supplies its own normal from its early recordings
(`investigation/recorded.py`), which is how the alarm-to-investigation path
calls the engine.

**Consequence.** On that rig and six variants of it (sensor units scaled by
0.01 and by 37, noise tilted the other way, sampled at 25.6 kHz in 1.28 s
snapshots on an 8-ball bearing, a healthy 1x barely above the noise, a normal
recorded 2 % slower), 42 cases over a healthy machine and five faults: 40 named
correctly, 2 healthy machines left unresolved, none wrong. The verdict no
longer moves with the sensor's units. This is a synthetic rig built to have the
problem; it is not evidence about a real machine. The number that matters is
`scripts/diagnose_runs.py` against `scripts/diagnose_runs.py --textbook` on
recorded bearings, which needs the dataset and has not been run with this
scoring. Without healthy captures the engine scores against the textbook
machine as before, and says so. Known limits: one healthy capture gives no
measure of the machine's own wander; a normal recorded at another speed moves a
tone between spectral bins and can cost a healthy verdict (unresolved, not
wrong); the early recordings of a run are assumed healthy.

## ADR-0016 · The simulator runs at the capture's own noise shape, tones are read where they cannot slip, and the leader must explain every line

**Context.** Three faults in how a capture was read and judged, found while
building ADR-0015. (1) Every simulation ran in white noise at one level, the
median above the sixth shaft harmonic. An accelerometer on a real machine shows
little noise near the shaft lines and most of it higher up, so one level puts
the simulated floor in the wrong place for the shaft lines or for the bearing
band: with the unit fixed from the quiet 1x, an inner-race fault predicted
envelope lines far taller than the loud band let through, and the case ended
unresolved on a line 171 times the median. (2) A shaft-order tone was searched
within the same ±2 % as a bearing line. Tones do not slip, and the wide window
let a ball-pass rate of 3.08x leak into the reading of 3x. (3) Beliefs only
rank the hypotheses, so the nearest one took all of it: a rig whose 3x alone
had grown was called misaligned at 0.95, though misalignment also predicts a
taller 2x and the 2x had not moved.

**Decision.** (1) The capture's noise is read in two places, near the shaft
lines and in the resonance band (`noise_profile`). When they differ by
`FLAT_NOISE` or more, the simulated noise climbs from one level to the other
(`Signature.noise_low`); otherwise it is white, as before. (2) Raw tones are
read within `TONE_TOLERANCE` (±0.5 %); envelope lines keep ±2 %. (3) Before a
verdict the leader is checked against every line at the severity the evidence
favours (`Investigation.misfit`): a line further than `FITS_NONE_SIGMA` from
what it predicts blocks the verdict, and the case ends unresolved naming the
line. One case is exempt: a line of its own that reads above its prediction at
the strongest severity simulated is more of the same fault, not another one.

**Consequence.** Scored against the textbook, the rig of ADR-0015 no longer
gets a confident wrong verdict: of 6 cases 1 is named and 5 end unresolved
("misalignment leads but does not explain the line at 4x"), where before the
check the healthy rig and the one with an imbalance were both concluded as
misalignment. A suspect written for the unexplained line is then simulated and
scored like any other, and takes the belief when it fits
(`tests/test_own_normal.py`). The 180 cases of ADR-0014, answered honestly,
still give no wrong verdict: 130 correct and 50 unresolved. One earlier figure
no longer holds: the faint outer-race capture ADR-0014 reports as called
healthy at 88 % now leads with healthy at 80 %, just under the bar, and is not
concluded on the first look.

## ADR-0017 · One way in for evidence, whoever is calling

**Context.** Three kinds of caller reach the engine: the replay and API, the
investigator agent through the case store, and the alarm-to-investigation path
on recorded runs. The last drove the engine itself in two places, read each
requested check out of a recording as a number, and so lost the capture's
length and noise; an agent's case could only be answered with a number.

**Decision.** A recorded run is investigated in one place
(`investigation/recorded.py`): the reading is one recording, the run's early
recordings are its normal, and a requested check is answered by handing the
next recording to the engine whole. `tools.cases.open_case` takes the same
`normal`, and `record_measurement` accepts a capture as well as a number. A
check nobody can answer is marked as not taken and the next most useful one is
asked for. `docs/ARCHITECTURE.md` lists every source of evidence and its door.

**Consequence.** `api/maintenance.py` and `scripts/diagnose_runs.py` share that
path, and the tab is told the outcome as it is: a fault only at the bar, a
healthy verdict with its limit, or unresolved with the reason. Still missing: a
door for a live sensor, and a place to keep a machine's healthy captures
between cases.

## ADR-0018 · What a model does is shown, and a failed model does not lose the case

**Context.** The investigator loop existed only behind an endpoint. Nothing on
screen showed what the model did, what it was not able to do, or which model
had run. A live model can also fail for reasons that have nothing to do with a
case (no quota, a retired model id, the network), and a failure then lost the
case with a server error.

**Decision.** A run keeps every tool call with what the tools answered
(`InvestigationRun.steps`). `agents/trace.py` turns each into two plain
sentences, what the model asked and what the physics answered, using only
figures from the tool result; the model's own words appear only where it
narrates. `/agent/about` reports the tools, their parameters and the run's
limits from the code, so the screen cannot promise more than the tool layer
allows. When a live model raises, the offline investigator picks the case up
where it stands and the run says that it did and why; a failure of the offline
investigator itself is a bug and is raised.

**Consequence.** The Investigator tab shows a case as two voices, and says
which model ran. It has only been run with the offline stand-in: no Gemini
call has been made, so the instruction, the tool declarations and the model id
are untested against the real service.

## ADR-0019 · The deployed link works on every tab, with a synthetic life where it has no data

**Context.** Built as the image was, the deployed link had two dead ends. The
maintenance tab was empty, because no dataset ships in the image and a package
installed as a wheel looked for `data/` inside the Python library folder. The
lens tab refused every upload, because the image did not install the library
that reads video.

**Decision.** One definition of where data lives (`data/root.py`): the
`CRUX_DATA` setting, else `data/` in a checkout, else `data/` under the working
directory. The image installs every optional group a tab needs and gives the
app a folder it may write to. With no recorded run on the server, the
maintenance routes serve a synthetic pump life (`data/demo.py`): thirty hours at
a snapshot every ten minutes, healthy until an outer-race fault starts and
grows by a fixed factor per snapshot. The pump has a normal of its own (a 2x
taller than its 1x, noise that rises with frequency), so the life also shows
what scoring against a machine's own normal changes: each investigation
reports what the same moment would have led with against a textbook machine.
A recording now carries its own snapshot interval, so an hour on the screen
maps to the right snapshot on any of them.

**Consequence.** On a server with no data the path from health to alarm to
investigation to ticket can be walked end to end, and every number on it is
labelled synthetic. It is the engine run on its own signal model and proves
nothing about a real machine. On it the watcher alarms at snapshot 162 of 180.
Scanned at every second snapshot, the investigation names the outer race from
snapshot 124 on (a test pins 130, about five hours of running before the
alarm); at 120 and 122 it declines to conclude and points at the fault that
predicts the impacts it sees; before that it reads the pump as healthy, as it
will any fault fainter than the mildest it simulates. Checked by installing the
project the way the image does and calling every tab's routes; the image itself
was not built here.

## ADR-0020 · A live sensor has a door, and it is closed by default

**Context.** The firmware posted to `/ingest`, the architecture drew it, and
the route did not exist. A machine's healthy captures also had nowhere to be
kept between cases, which the own-normal scoring of ADR-0015 needs.

**Decision.** `POST /ingest` takes the firmware's batches as they are.
`data/stream.py` keeps the latest unbroken minute per machine; a batch that
does not follow on starts a new stretch. A person marks the latest signal as
the machine's normal, and opens a case on the latest two seconds, which is then
a case like any other. Only machines whose bearing and speed are on file are
accepted. Every route that writes needs `RIG_INGEST_TOKEN`, and with none set
they answer that ingestion is off.

**Consequence.** The hardware path has its server side and a test that posts
what the firmware posts. Not run with the hardware. Memory only: a restart
forgets the signal and the normal.

## ADR-0021 · The engine states the result; a model may explain a verdict, and each sentence it writes is held to its evidence

**Context.** The verdict's wording was fixed text. A narrator adapter existed
for Gemini, a local model and templates, `/health` listed it as running, and no
code path called it. The repair ticket already had a rule for model-written
text: a sentence is kept only if every number in it is in the evidence it cites.

**Decision.** `agents/report.py` writes a case's result as two voices.

The engine's lines are the result: the verdict, why, what a healthy verdict
could not have seen, what to do, and what would change it. They come from the
closed case and no model writes, rewords or reorders them. A reworded action
("at the next window" becoming "now") is a different instruction, and no check
on numbers could tell.

A model (Gemini, else a local model, else none) may add an explanation of a
verdict. Each sentence must cite what it rests on and is kept only if: it cites
at most three entries and each exists; every number in it is in what it cites;
every suspect it names is named in what it cites; and it calls nothing normal,
acceptable or within range unless what it cites does. A measurement names no
cause, so a sentence that names one has to cite the engine's verdict or that
suspect's own simulation. It may cite the ledger and the engine's verdict,
reasoning and limit, not the action or what would change the verdict. A sentence
that fails is listed with the reason. A reply is bounded in time and length, and
a failed, cut-off or malformed reply leaves the engine's lines alone, with the
reason recorded. `CRUX_REPORT_MODEL=off` turns the explanation off.

A case with no verdict is not given to a model. There the reason is the whole
result, and it is the part a paraphrase gets wrong most easily.

`GET /investigations/{id}/report` serves it. `writer=careless` runs a test
writer that makes three false claims and one true one on purpose, so the check
can be watched; the screen labels it as that. The narrator adapters are removed:
`/health` lists only call sites that something calls.

**Consequence.** The check holds numbers, names and a short list of judgement
words. It cannot tell whether a sentence that passes is a fair reading of its
evidence, and the screen says so. Tried with fake writers in the tests and with
a local 7B model (Mistral through Ollama) on synthetic cases, which is where
three of the rules came from: it cited a dozen entries per sentence, called
readings "within acceptable limits", ran past three minutes on one reply, and on
a case with no verdict wrote that a reading could not be taken "because the
housing temperature was too high", which no entry says and which passed every
rule then in place. Under the rules as they stand it wrote 10 sentences on five
verdicts: 6 were kept and 4 removed, each for naming a cause its evidence did
not name. One kept sentence calls a crest factor "high" with nothing in the
evidence to say what high is; that is the limit above, seen. Not run with
Gemini: there were no credentials. The numbers in the constants table
(docs/DOMAIN.md) are judgement calls made on that one small model.

## ADR-0022 · Whether a case has a verdict is the engine's call, and so is the reason when it has none

**Context.** The investigator closes a case without a verdict through a tool
that took its reason as text, and the case stored that text as its own reason.
With the offline investigator the text was assembled from tool results. With a
live model it would be whatever the model wrote, shown on the Investigator tab
and quoted on the repair ticket as the case's reason. The same tool also let a
model close a case the evidence had settled.

**Decision.** The tool refuses while nothing blocks a verdict, and says to
conclude. Otherwise the engine closes the case by its own rule and records its
own reason: what blocks a verdict, any reading nobody could take, and that the
investigator closed the case. The model's reason is kept beside it as the
investigator's (`Case.investigator_reason`) and the screen shows it as that.

**Consequence.** `unresolved_reason` is always the engine's words, wherever it
is shown. The clue the offline investigator used to pass on in it ("match no
frequency of this bearing; look for a rub, a loose part or a gear mesh") is now
under the investigator's name, and in the step where the physics reported it.

## ADR-0023 · A suspect accounts for the rate its impacts rise and fall at

**Context.** A damaged rolling element strikes at twice its spin rate, harder
each time the cage carries it through the load zone. The simulator models that
as amplitude modulation, which puts a line at the cage rate itself in the
envelope. The check for impacts no suspect predicts counted the sidebands of a
modulated suspect and not that line. On the replay rig's rolling-element fault
at noise 0.45 the cage-rate line was the strongest unexplained line in 1 of 12
captures tried. There the offline investigator wrote a cage suspect, the
physics refused it as indistinguishable, and the case ended unresolved; with the
rolling-element suspect written by hand the belief reached 99% and the verdict
stayed blocked by the suspect's own line.

**Decision.** `explained_lines` adds the modulation rate to what a suspect
accounts for. It is used only by the unexplained-impact check; the scored lines
are unchanged, so no belief moves. The offline investigator writes the
rolling-element suspect for a match on the cage rate as well, and no longer
writes a suspect of impacts at the cage rate alone.

**Consequence.** The rig's rolling-element fault concluded in 24 of 24 captures
tried (11 of 12 before). For the catalogue nothing changes: its one modulated
hypothesis is modulated at shaft speed, which every suspect already has. A real
cage fault has not been tried; the expectation, untested, is an unresolved case
with the rolling-element suspect tested and low.

## ADR-0024 · A repair is checked by investigating the machine again, not against a typed improvement

**Context.** Repair verification was one function, reachable only from the
command-line demo. It compared the drop in overall vibration with a table of
expected reductions per fault (0.60 for imbalance, 0.65 for a bearing race and
so on) that had no source, and called the repair verified at 60% of that. It
could not say that a fault was still there, nor that the repair had left
another one.

**Decision.** `investigation/repair.py` takes the closed case and a capture
made after the repair, and investigates that capture as a case of its own: the
same suspects, including any written during the first case, every one back at
even odds, scored against the machine's own normal when the first case had its
healthy captures. The answer is the engine's verdict on the machine as it now
runs. Five answers: verified (it fits the machine running normally), still
there, something else (with that fault's own action), cause gone (the repaired
cause is below the rejection threshold but the capture settles nothing more),
and cannot tell. Beside it are the lines the repaired cause predicts, as each
read before and after and in a healthy machine, for the reader; the answer does
not come from them. The typed table is deleted.

Where someone can answer, the follow-up asks for a measurement when one capture
is not enough, as the first case could; with nobody to ask it closes on the one
capture and says so.

`POST /investigations/{id}/repair` runs it on the synthetic rig, where the
caller says how much of the fault the repair removed or which fault it left;
the engine is not told, and the rig answers what the follow-up asks for in the
state the repair left it in. `POST /ingest/{machine}/repair/{id}` runs it on a
live machine's latest signal, with nobody to ask. The Guided answer offers the
three repairs.

**Consequence.** On the 12 kHz rig a full repair is verified for all five
faults, half a repair is not, and the sentence names the fault's own line still
standing (for a bearing race the line at its rate, not the taller 1x every
machine has). A verified repair carries the healthy verdict's own limit: after
balancing, a mild imbalance cannot be excluded from one two-second capture, and
the check says so. On a noisy floor (noise 0.45) one capture cannot verify a
good repair of a moderate bearing fault; one more reading can, and that reading
is the housing temperature, scored against a table nobody has measured, which
the check then states. Half a repair there stays unsettled after two more
readings. The 2 kHz hardware rig cannot see where bearing damage
shows, so it never concludes "healthy"; there the most it can say is that the
repaired cause is gone, which is the fourth answer. Captures after a repair
come from the same synthetic rig as the first; not run on a real repair.

## ADR-0025 · A person's note is kept and shown, moves nothing, and is searched for a hazard

**Context.** A technician at the machine sees, hears and smells things no
sensor reports, and there was nowhere to put them. The investigator's
instruction already said that text inside a case is data, with no such text to
apply it to. Free text is also the obvious way to try to steer a language
model, and the obvious place for someone to mention smoke.

**Decision.** A note is kept with the case under an id of its own (N1, N2),
apart from the ledger, because it is not evidence. The engine never reads it:
no note moves a belief, requests a measurement, or opens or closes a case,
whatever it says, and a note can be added after the verdict. A model sees notes
in the case as data and has no tool that writes one. A note reaches the
diagnosis one way: a model may write a suspect for what it describes, and the
physics tests that suspect like any other. A model's explanation of a verdict
cannot cite a note.

Each note is searched for a short list of words that describe a hazard
(`investigation/notes.py`). A match sets a flag on the case, shown above the
verdict and first in the report: stop, make the machine safe, call a
supervisor. The flag changes nothing below it. The search errs towards
flagging: "no smoke" is flagged too, because waving a note through on a "not"
is the worse mistake, and a person reads the note either way.

`POST /investigations/{id}/notes` takes a note; `/agent/replay` takes one to
put on the case before the investigator starts.

**Consequence.** What an order in a note can do is bounded by the tools, not by
the model obeying its instruction: no tool takes a belief, a verdict needs the
engine's own bar, and a case the evidence settles cannot be closed as
unresolved (ADR-0022). A model that did obey could still ask for a measurement
nobody needs, write a suspect the physics then refuses, or say something
wrong in its own narration. Tested with the offline investigator, which does
not read notes and so works the case identically with and without one; how a
real model treats an order in a note has not been tried. The hazard list is
short, English only, and will miss a hazard described in other words: it is a
prompt to a person, not a safety system.

## ADR-0026 · The real-data benchmark reads each file at its own rate and scores it against the healthy recording at its load

**Context.** Two things stood between the benchmark and a number that means
anything. The loader labelled every CWRU file 12 kHz, and the healthy baselines
it fetches were recorded at 48 kHz (Smith & Randall, Mech. Syst. Signal
Process. 64-65 (2015) 100-131, Table A1; the CWRU page gives no rate), so each
healthy recording would have been read with every line at a quarter of its
frequency. And every case was scored against the textbook machine, which is the
mode that failed on the first real recordings tried (ADR-0015).

**Decision.** The loader brings a healthy baseline down to 12 kHz and checks
the rate against the file's own shaft line; where the file and the document
disagree, the file is believed and the capture's source says so. The benchmark
keeps the first 40% of each load's healthy recording, as four captures, as that
machine's normal, scores every recording at that load on the change from it,
and uses the rest of the healthy recording as the healthy case. `--textbook`
scores against the textbook machine for the comparison. Each run is written to
a result file with every case, the counts, the settings and the commit.

**Consequence.** Found before any data was on hand; the first number has not
been produced. Tested on made-up files in the dataset's shape, from a simulated
machine whose normal is not the textbook's: against its own normal three of
three recordings get the right verdict, against the textbook none gets a
verdict at all. The lengths of the real baselines, and so how much of each is
left for its case, have not been checked.

## ADR-0027 · A closed case leaves a record, and the next case on that machine is shown it

**Context.** Every case started knowing nothing about the machine's past. A
model working a case had memory for one run only.

**Decision.** When a case closes, code writes a record from it
(`investigation/history.py`): the machine, the outcome, what settled it, and
later what the check after the repair found. A case is handed the records of
its machine as it opens. People see them on the screen and a model can ask for
them (`recall_cases`). A record is knowledge, never evidence: the engine does
not read it, and an earlier verdict is not a prior, because how often a fault
recurs on a machine is not something anyone here has measured. A model has no
tool that writes a record. Cases are kept per plant and machine, so visitors
to a shared link do not see each other's.

**Consequence.** In memory, or in a file when `CRUX_HISTORY_FILE` names one. On
Cloud Run the file system is memory too, so the history lives as long as the
instance; a database goes behind the same four methods.

## ADR-0028 · A machine's documents can supply a suspect, and the suspect is held to the passage

**Context.** When the capture held impacts no suspect predicted and no bearing
frequency matched, the case could only end unresolved. What else turns with the
shaft is written in a machine's manual, not in a bearing table.

**Decision.** `knowledge/` cuts the documents on file for a machine into
passages and finds them by the words they share with a question
(`search_knowledge`). A suspect may cite passages. Before the physics sees it,
every number in its description and every rate it is simulated at must be
stated in what it cites; a rate a model worked out from two other figures is
refused. Then the physics tests it like any other suspect. A passage is
knowledge, never evidence.

**Consequence.** One document is on file, for the demo pump, written for this
project from the rig's own constants and labelled a demo document on every
passage. It names an auxiliary pump that knocks 5.7 times per shaft turn; a new
rig fault at that rate is found through it. That is circular in one respect:
we put the fact there. It shows the path, a document to a suspect to a physics
test, not that a real manual would hold the fact. Retrieval is by words, not
embeddings: enough for one document, and it runs with no model.

## ADR-0029 · Two agents with separate tools: one can close a case, the other can write a suspect

**Context.** One agent held every tool. The same model that wrote a suspect
could then ask for the verdict on it.

**Decision.** The tools are split (`tools/investigator.py`). The investigator
reads the case, asks the physics what to measure, and closes the case; it has
no tool that writes a suspect. The critic is called by the loop's code when a
verdict is blocked by something no suspect explains, once per case; it can
look at the bearing's frequencies, the machine's documents and its earlier
cases, and write one suspect; it has no tool that closes a case. Neither has a
tool that takes a belief. Whether the critic has had the case is in the case
itself (`critic_consulted`), so the two do not depend on reading each other's
conversation.

**Consequence.** The split is enforced by the framework, not by the
instruction: an agent that calls a tool it was not given is told there is no
such tool, and nothing reaches the engine (`tests/test_agent_loop.py`). Run
with the two offline stand-ins only; not with Gemini.

## ADR-0030 · The check is the writer's feedback, and code ends the rewriting

**Context.** A sentence that failed the evidence check was removed, and that
was the end of it. A weak model lost most of what it wrote.

**Decision.** What fails is handed back to the model with the reason, to
rewrite, at most twice. The model is never asked whether its sentence is
backed: the check decides. Every draft the check rejects stays listed.

**Consequence.** With a local 7B model on five verdicts, 4 sentences failed at
first; after the loop 10 sentences stood and 5 rejected drafts were listed.
The limit of the check is unchanged (ADR-0021).

## ADR-0031 · A run can be read while it happens, and the machine's parts come from its spec

**Context.** `/agent/replay` returns an agent run when it has finished. With a
live model that is a minute of nothing on screen; a screen could only replay a
record. And a drawing of the machine had no source for its numbers: the
bearing's geometry and the rates of its parts were in the code and in no
response, so a screen would have had to carry its own copy.

**Decision.** `investigate_async` takes an optional hook, called when a tool
call is made and again when the tools answer it. `POST /agent/stream` runs the
same case as `/agent/replay` and sends those steps as server-sent events, then
the finished run. The words in a step are written by the same code either way
(`agents/trace.py`). `GET /machine` returns the machine's spec and, per turn of
the shaft, how far the cage turns, how often a ball spins and how often a ball
passes a point on each ring, from `physics/frequencies.py`.

**Consequence.** Nothing in the loop depends on the hook, and `/agent/replay`
is unchanged. A screen can show the active agent, the tool and the answer as
they occur, and a drawing in which each part turns at the engine's own ratio:
a ball then meets a damaged spot at the rate the engine listens for, without
that rate being typed anywhere. Streamed with the offline stand-ins only; not
with Gemini.

