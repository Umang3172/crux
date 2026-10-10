# Domain notes: the physics, and where every number comes from

If you change a constant in `physics/signatures.py` or
`investigation/catalog.py`, change the row here too. A number without a source is
a bug.

## Fault frequencies

For a rolling-element bearing with `n` elements, ball diameter `d`, pitch
diameter `D`, contact angle `α`, at shaft frequency `fr = rpm / 60`:

| Name | Meaning | Formula (× shaft speed) |
|---|---|---|
| FTF | cage / fundamental train | `0.5 · (1 − (d/D)·cos α)` |
| BPFO | ball pass frequency, outer race | `(n/2) · (1 − (d/D)·cos α)` |
| BPFI | ball pass frequency, inner race | `(n/2) · (1 + (d/D)·cos α)` |
| BSF | ball spin | `(D/2d) · (1 − ((d/D)·cos α)²)` |

Two checks worth remembering: `BPFO + BPFI = n · fr` exactly, and defects on a
rolling element usually show at **2 × BSF**, because the defect strikes both
races per rotation.

**Reference values.** The CWRU drive-end bearing (SKF 6205-2RS JEM, n = 9,
d = 7.94 mm, D = 39.04 mm, α = 0°) gives BPFO 3.5848×, BPFI 5.4152×, FTF 0.3983×,
2×BSF 4.7135×. These match the multipliers CWRU publishes, and
`tests/test_frequencies.py` asserts it to 1e-3. Source: Case Western Reserve
University Bearing Data Center, bearing information page.

## What each fault looks like

Standard rotating-machinery diagnosis. Amplitudes are *relative*, because the
comparison is scale-invariant — shape is what separates the causes.

| Fault | Signature | Physical reason |
|---|---|---|
| **Imbalance** | 1× dominant, little else; grows roughly with speed² | A heavy spot pulls once per revolution |
| **Misalignment** | 2× above 1×, often 3×, sometimes axial | The coupling is loaded twice per revolution |
| **Looseness** | A run of harmonics (1×…5×) plus half-order peaks | The joint opens and closes; the response is non-linear |
| **Outer race** | Impacts at BPFO, **no** 1× sidebands | The defect is stationary in the load zone |
| **Inner race** | Impacts at BPFI **with** 1× sidebands | The defect rotates in and out of the load zone |
| **Healthy** | Small 1×, a smaller 2×, broadband noise floor | Normal running |

A fault adds to the running tones; it does not replace them. Every signature
carries the normal 1× and 2× (`BASELINE_1X`, `BASELINE_2X`), so a bearing fault
is a healthy machine plus impacts, and a mild fault is a small change on a
normal machine.

The impacts matter more than the fault frequency itself: a spall rings a
structural resonance (a few kHz), and that ringing is amplitude-modulated at the
fault rate. Hence envelope analysis — band-pass the resonance, take the Hilbert
envelope, then the FFT of the envelope.

## Features the investigator sees

From `signals/features.py`:

| Feature | Definition | Used for |
|---|---|---|
| `amp_2x`, `amp_3x`, `amp_half_x` | Peak height at that order, relative to 1× | Shaft-order faults |
| `harmonic_run` | Mean of 3×, 4×, 5×, relative to 1× | Looseness |
| `env_bpfo`, `env_bpfi` | Envelope peak at the race frequency, as a multiple of the envelope median | Bearing faults |
| `env_contrast` | `log10((env_bpfo + 1) / (env_bpfi + 1))` | **Which race**: positive = outer, negative = inner, ≈0 = not the bearing |
| `crest_factor` | peak / RMS | Impulsiveness; rises with a spall |

`env_contrast` exists because the raw envelope height moves with load, speed and
sensor mounting, so it cannot be predicted per hypothesis. The ratio can.

These named features feed the ledger and the measurement catalogue. The first
look is scored on something else, below.

When the capture cannot see the resonance band (the ESP32 rig at 2 kHz), the
three envelope features are reported as **not available**, never as a substitute
value, and the engine stops asking for measurements that need them.

## Order tracking

Every frequency above is a multiple of shaft speed, so the speed it is read at
decides whether the peak is found at all. BPFI is 5.4× shaft speed: a 3% speed
error moves it by about 5 Hz, wider than the peak, and an inner-race defect then
reads as healthy. `signals/features.py` therefore measures the speed from the
signal before reading any order or bearing frequency, and the ledger records both
the reported and the measured speed.

| Constant | Value | Source |
|---|---|---|
| `SPEED_SEARCH_FRACTION` | ±5% around the reported 1× | CWRU's own load table spans 1730–1797 rpm (3.7%, `docs/DATA.md`); ±5% covers that plus a nameplate or tachometer offset, and stays far from the 0.5× and 2× peaks |
| `SPEED_PEAK_PROMINENCE` | 1× peak ≥ 4 × spectrum median | Noise-only spectral magnitudes are Rayleigh distributed, so one bin exceeds k × median with probability 2^(−k²): 1.5 × 10⁻⁵ at k = 4. Below that, the reported speed is kept and the ledger says why |
| `BEARING_SLIP_FRACTION` | ±2% of each bearing frequency | Rolling elements slip, so real defect frequencies sit 1–2% from the kinematic value: R. B. Randall and J. Antoni, "Rolling element bearing diagnostics — A tutorial", *Mechanical Systems and Signal Processing* 25 (2011) 485–520 |

The speed estimate scores each candidate 1× by the sum of its 1×, 2× and 3×
magnitudes, so a 2×-dominant machine (misalignment) still locks onto the right
fundamental, then refines the peak with Gaussian interpolation on the three log
magnitudes around it.

## How the first look is scored

`physics/likelihood.py`. For every line any hypothesis predicts (its tones in the
raw spectrum; its impact rates, their second harmonics and their 1× sidebands in
the envelope spectrum), the capture's line height is
`log10(peak within the tolerance / median of the spectrum around it)`. Each
hypothesis is simulated at the capture's speed and noise, the same heights are
read from every simulation, and the capture is scored with a Student-t per line.

| Constant | Value | Where it comes from |
|---|---|---|
| `TONE_TOLERANCE` | ±0.5 % of the line | For a shaft-order tone in the raw spectrum. Shaft harmonics are exact multiples of shaft speed and do not slip, so the only error is in the speed, which is read from the capture's own 1× to within 0.2 % (`tests/test_order_tracking.py`). The tight window keeps a bearing line that falls near a shaft order (a ball-pass rate of 3.08× beside 3×) out of the tone's reading. |
| `LINE_TOLERANCE` | ±2 % of the line (envelope lines) | Measured ball-pass frequencies run "generally 1-2 % in deviation from the theoretical calculated frequencies" because rolling elements slip (Sawalhi, *J. Vibroengineering* 20(3):1322, 2018). The band covers the top of that range. |
| `SEVERITY_GRID` | 0.25, 0.5, 0.75, 1.0, 1.5 | The severity of a fault is unknown before the diagnosis, so the likelihood averages over this span of the signature model's own severity scale instead of assuming one. A range, not a measured quantity. |
| `SEEDS_PER_SEVERITY` | 4 | Enough simulations to estimate a spread per line; at about 2.5 ms each, the first look costs about a quarter of a second. Compute budget, not physics. |
| `MODEL_MISMATCH` | 0.15 (log10; ×1.4 in amplitude) | **Assumption, not yet calibrated.** The signature model is reduced-order, and a real machine will not match its line heights more closely than this. Calibrate on development recordings (the 0.007″ CWRU files), never on the files a result is reported on. |
| `STUDENT_T_DOF` | 4 | **Judgement call.** Heavy tails cap what one badly modelled line can cost, so no single line decides a case. The method: Lange, Little & Taylor, *JASA* 84:881, 1989. |
| `FLOOR_MIN_BINS` | 160 bins | The floor around a line is the median of at least this many spectral bins. A median of n noise bins scatters by about 0.72·√(1.5/n) of itself (Rayleigh magnitudes; a Hann window leaves about n/1.5 independent bins): 0.03 in log10 at 160, against 0.08 at the 28 bins a quarter-band gives around 1× in a two-second capture. Measured on white noise in `tests/test_likelihood.py`. A design choice: enough bins that the floor's scatter is small beside `MODEL_MISMATCH`. |
| `FLAT_NOISE` | a factor of 1.5 | The simulator runs at the capture's own noise, read in two places: near the shaft lines and in the resonance band. When the two differ by less than this the noise is simulated as white: 1.5 moves a line's height by 0.18 in log10, about `MODEL_MISMATCH`. Above it the simulated noise climbs from one level to the other over `NOISE_RAMP_OCTAVES` (2). A design rule. |
| `READING_SEEDS` | 2 | Simulated captures per severity when predicting what a requested measurement reads. A requested capture is 10 to 30 s long, so its sampling spread is small beside the test's own allowance, and each simulation costs up to 26 ms. Compute budget, not physics. |
| `FALSE_ALARM_RATE` | 1 % per capture | **Design target.** A noise-only bin's power over the median exceeds x with probability exp(−x ln 2); the largest of N bins with 1 − (1 − exp(−x ln 2))^N. Solving at 1 % sets the unexplained-line threshold (about 16× the median power for 800 bins). `tests/test_likelihood.py` checks it on white noise; check it on healthy recordings before trusting it on a machine. |
| `FITS_NONE_SIGMA` | 4 σ | A reading further than this from every hypothesis' prediction fits none of them: the two-sided Gaussian tail beyond 4 σ is about 6 × 10⁻⁵. |
| `DISTINCT_SIGMA` | 1 σ | Two hypotheses that differ by less than this cannot be told apart. A suspect written during a case must differ from every existing hypothesis, at every severity it is simulated at, by at least this on some predicted line, or it is refused. A test is offered only if the two leading hypotheses are expected to read this far apart. A design rule. |
| `BASELINE_1X` | 0.25 | The height of the normal 1× running tone in every signature. Heights are relative, so this only fixes the unit a written suspect's "4× as tall" is measured in. |
| `BASELINE_2X` | 0.06 | The height of the normal 2× running tone, about a quarter of 1×, in every signature. A modelling choice in the same relative units. A machine's own healthy captures replace it (below). |
| `CLEAR_TONE` | 3 × a noise-only line | A machine's healthy 1× fixes the unit only where it stands this far above what a line reads on noise alone. Below it the height is mostly chance, and the model's own tone-to-noise ratio is assumed instead. A design rule. |
| `LEVEL_RISE` | 2 × its own normal | A healthy verdict is refused once the capture's overall vibration (RMS) has doubled over the machine's healthy captures. The same doubling the watcher needs before it alarms (`MIN_RISE`, `docs/FORECAST.md`), so the two never disagree about a machine that has changed. |
| `NORMAL_SNAPSHOTS` | recordings 2 to 6 of a run | What a recorded run's own normal is taken from (`investigation/recorded.py`): the start of its life, after the first recording, which on a freshly mounted bearing is still settling. A choice, to be checked against each dataset's healthy period. |
| `REJECT_BELOW` | 3 % | Display only: below it a hypothesis is shown as rejected. It stays in the distribution. |
| `CONCLUDE_ABOVE` | 80 % | The bar for a verdict. Below it the case asks for a measurement or ends "unresolved". |

What the scoring cannot do, said plainly:

- **Healthy against mild imbalance.** They differ only in how tall 1× stands,
  and without the machine's own healthy captures that is weak evidence. The first look
  splits between them, and the engine asks for the measurement that separates
  them (a coast-down) rather than guess.
- **A fault too faint for the capture.** A weak bearing fault in a short, noisy
  capture looks exactly like a healthy machine, and may be called healthy. The
  verdict then lists every fault it could not have seen: those that, at the
  mildest severity simulated, fit the evidence nearly as well as healthy does
  (one against one, keeping at least `REJECT_BELOW` of the belief).
- **The sensor's units, with no normal on file.** Signature amplitudes are in
  the model's own units and are tied to a capture only through its noise, so
  the predicted heights assume the model's ratio of running tone to noise, and
  a machine whose normal spectrum is not the textbook's can read as a fault. On
  the synthetic rig neither matters, by construction. On a real machine both
  do, until healthy captures of it are given (next section).
- **A change no hypothesis makes.** Beliefs only rank the hypotheses, so the
  nearest one can take all of it. Before a verdict the leader is checked
  against every line at the severity the evidence favours: a line further than
  `FITS_NONE_SIGMA` from what it predicts blocks the verdict, and the case ends
  unresolved naming the line (`Investigation.misfit`).

## The machine's own normal

`physics/normal.py`. The signatures draw a textbook machine: 1×, a quarter of it
at 2×, nothing else. A real machine has its own normal spectrum. A rig whose 2×
has always stood taller than its 1× reads as misaligned against the textbook,
healthy or not.

Given healthy captures of the same machine (`Investigation(..., normal=...)`),
the case is scored on the change from them instead:

1. **Units.** Heights in a signature are multiples of the normal 1× tone. The
   simulator's noise is set so that its textbook 1× stands as far above the
   floor as this machine's healthy 1× does. The verdict then does not move with
   the sensor's units (g, m/s², counts).
2. **Quirks.** A tone is taken as its amplitude above the noise, in floors.
   What the machine has gained at each line since it was healthy is added to
   the textbook healthy machine, and that is what is scored. Amplitudes add, so
   a fault is credited with exactly what it adds: on a rig whose 2× is already
   tall, a misalignment is a small step in height and a large one in amplitude.
3. **Noise that has risen.** A line is read against its local floor, so each
   healthy capture's tone is first restated at today's floor. An unchanged tone
   under louder noise is not a change.
4. **Wander.** With several healthy captures, each is restated the same way and
   their spread widens every prediction at that line. A tone that moves from
   one healthy day to the next is not evidence when it moves again.
5. **Its own impacts.** Periodic impacts present in the healthy captures count
   as explained, so they are not mistaken for a cause missing from the list.
   The strongest eight per capture are looked for (`NORMAL_LINES_MAX`, a
   compute budget), each clearing the false-alarm threshold above.
6. **A requested capture** is restated the same way: its feature, less what the
   healthy captures read for it, cut to the same length.

A healthy verdict is refused once the overall level has doubled (`LEVEL_RISE`):
nothing on the list explains the change, and a healthy machine does not either.
The ledger records how many healthy captures were used, the level against
normal, and the lines that moved most.

Without healthy captures the engine scores against the textbook machine, as
before, with the two limits above.

## When the list is missing a cause

Before a verdict the engine looks for the strongest envelope line the hypotheses
do not explain. Harmonics up to 6x of an explained line, its 1x sidebands, and
shaft harmonics up to 12x all count as explained. So does the rate a
hypothesis's impacts are modulated at (`explained_lines`): impacts that rise and
fall put a line at that rate itself in the envelope, and the simulator produces
it. The modulation rate is not a scored line; for the catalogue it sits on a
shaft harmonic. Such a line blocks a verdict
only when it clears the false-alarm threshold above and is stronger than every
line the same hypotheses do explain. A line the whole list leaves out blocks at
any belief, because it would block whichever of those hypotheses came to lead.
No reading on the menu can settle it, so none is requested.

`bearing_frequency_matches` then compares that line with the bearing's own
frequencies:

| Constant | Value | Where it comes from |
|---|---|---|
| tolerance | `LINE_TOLERANCE`, ±2 % | The same slip band as the scoring, for the same reason. |
| harmonics | up to 3x of FTF, 2xBSF, BPFO and BPFI; BSF once | An impact train's envelope spectrum carries the first few harmonics of its rate. BSF itself is for a defect that strikes only one race hard. Above 3x the candidates crowd together: on the 6205, 3x BPFO and 2x BPFI are already 0.7 % apart, so both are reported when both fit. A design choice. |

A match points to the part that strikes: FTF to the cage, BSF or 2xBSF to a
rolling element, BPFO and BPFI to the races. The offline investigator writes one
suspect, a rolling element, for a match on BSF, 2xBSF or FTF. It writes it at
the catalogue's bearing-fault strength: impacts of 1.0 at severity 1, which is
4x `BASELINE_1X`, at 2xBSF and modulated at FTF, because the cage carries the
defect in and out of the load zone. A line at FTF alone is read the same way: on
the replay rig's rolling-element fault at noise 0.45, the FTF line was the
strongest unexplained line in 1 of 12 captures tried (seeds in
`tests/test_agent_loop.py`), and a suspect of impacts at FTF only was refused
there as indistinguishable. The physics still decides: a capture without strikes
at 2xBSF leaves the suspect low. Anything else is left unresolved, with the line
as the clue. A cage fault of its own is not on the rig and has not been tried.

The replay rig's off-catalogue faults (`data/rig.py`) are demonstrations, not
physics constants. `rolling_element` is impacts at 2xBSF, modulated at FTF.
`unlisted_impact` is impacts at 7.6x shaft speed, a rate chosen to sit on no
frequency of the 6205 (the nearest is 2x BPFO at 7.17x) and on no shaft
harmonic. Both ring the same resonance, at the same strength, as the
catalogue's bearing faults.

The rig after a repair (`POST /investigations/{id}/repair`) is the same rig
with the fault at whatever share the caller says the repair left, or with a
fault the repair itself left behind at severity 0.75 (`LEFT_BEHIND_SEVERITY`):
a demonstration value, clear in one capture and short of the catalogue's full
strength. The rig holds one fault at a time.

## The result in words

`agents/report.py` holds a model's explanation of a verdict to the evidence it
cites. These are bounds on a language model, not physics, and every one is a
judgement call.

| Constant | Value | Where it comes from |
|---|---|---|
| `MAX_CITES` | 3 entries per sentence | A sentence that cites a dozen entries rests on none in particular, and nearly any number then passes the check. A local 7B model cited 7 to 12 entries per sentence when only told the limit; the reply's schema now carries it too, and the check holds whatever arrives. |
| `MAX_SENTENCES` | 6 | The model is asked for 2 to 4. The rest are dropped unread. |
| `TIMEOUT_S`, `MAX_TOKENS` | 30 s, 500 tokens | A local model held to the reply's schema ran past 3 minutes on one case until its reply was capped. A reply cut off by either bound is not valid JSON and is treated as a failure. |
| judgement words | normal, acceptable, expected, typical, nominal, limit(s), range(s) | The same local model called readings "within acceptable limits" and "normal" with no entry saying so. The ledger holds readings; what counts as normal is the engine's to state. A sentence may use one of these words only where the evidence it cites does. A short list from one model's failures, not a complete one. |
| rounding | a written number matches a value that rounds to it as written | From `ticket/draft.py`, the same rule the repair ticket uses. |

## Hazard words in a note

`investigation/notes.py` searches a person's note for these. Not physics, and
not a standard: a short list written for this product, every entry a judgement
call. A stem matches at the start of a word ("smok" finds smoke and smoking);
"fire", "flame" and "gas" match as whole words, so "fired" and "gasket" do not.

| Hazard | Words |
|---|---|
| smoke or fire | smok, smoulder, smolder, fire, flame, burning, burnt, burned, scorch |
| sparks or electric shock | spark, arcing, arc flash, electric shock, shocked |
| a leak | leak, dripping, spraying, puddle |
| damaged wiring | exposed wire, bare wire, frayed, melted, melting |
| overheating | overheat, too hot to touch, red hot, glowing |
| a guard off or a part coming loose | guard missing, guard is missing, guard off, guard is off, no guard, came off, coming off, cracked |
| gas or fumes | gas, fumes |

Left out on purpose: "hot" and "warm" (an ordinary observation, and temperature
is a measurement on the menu), "shock" alone (a vibration term), "crack" as a
stem (it finds "crackling"). There is no handling of "no" or "not": a note that
says there is no smoke is flagged.

## What a requested measurement will read

`investigation/catalog.py` lists the measurements the engine can ask for. How a
hypothesis's prediction for one is found depends on who answers it.

**A capture** (`vib_10s`, `envelope`, `half_order`). The test states how long a
capture its procedure asks for (`capture_s`: 10, 30 and 10 seconds). The engine
simulates every hypothesis at that length, at the first capture's noise and at
every severity, and reads the test's feature from each simulation with the same
extraction a real capture goes through. Nothing is typed. The length matters: a
longer capture resolves a weak line further above the floor, so an inner-race
fault of severity 0.5 in noise 0.45 reads about −0.06 on a two-second capture
and −0.45 on a thirty-second one. A capture handed over whole is scored at its
own length and noise.

**A value a person reports** (`temperature`, `coast_down`). There is no thermal
or run-down model, so these keep a table of first-pass values from standard
vibration diagnosis. **They are not calibrated against a machine**; treat them
as a documented guess. The table gives a full-strength fault. A milder one is
assumed to read proportionally closer to a healthy machine's value (linear in
severity up to 1), so a small reading does not count against a small fault. The
replay rig answers these two from a fixture built the same way, which makes
them circular on synthetic data; on recordings they are never answered. A
verdict with one of them in its evidence carries a sentence saying so
(`Conclusion.caveat`), shown beside the verdict.

`sigma` on each test is the allowance on a reading, in the feature's units: how
far a real reading may sit from the simulated or tabled one. It is typed, not
derived, and awaits calibration like `MODEL_MISMATCH`. The simulated spread
between captures is added to it.

**Severity is shared.** The evidence is kept per severity and averaged once, so
a hypothesis must explain the first capture and every reading at the same
severity.

**Which test is offered.** For each test the engine imagines every live
hypothesis answering it, three Gauss–Hermite points around its prediction at
each severity the evidence still allows, and works out the belief each answer
would leave. The entropy removed is the information gain; the share of answers
that bring some hypothesis to `CONCLUDE_ABOVE` is the chance of settling the
case. The test with the most gain per technician-minute is asked for, among
those with some chance of settling the case and with the two leading hypotheses
expected to read at least `DISTINCT_SIGMA` apart. If none qualifies, the case
ends unresolved with that as the reason.

The whole weighing is kept, not only the winner (`engine.Considered`): for every
test on the menu its expected gain, its minutes, its chance of settling the
case, how far apart the two leaders are expected to read, and why it won or
lost. It travels with the request, or with the case when nothing was asked
for, and the Guided screen shows it. The test asked for is the most information
per minute, which is not always the one most likely to settle the case: for the
inner-race capture `tests/test_menu.py` uses (severity 0.5, noise 0.45) the thirty-second envelope
capture is chosen at 0.069 nats a minute with a 12% chance of settling, ahead
of the temperature reading at 0.053 with 27%.

## Faults we deliberately do not induce on the bench

A real race spall cannot be faked on a desk rig without destroying a bearing and
still would not be repeatable. Bearing faults therefore come from CWRU
recordings, and the rig covers imbalance, misalignment, looseness and rub. Say
this plainly in the pitch; it is a strength, not a gap.
