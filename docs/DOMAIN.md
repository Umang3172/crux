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
| **Healthy** | Small 1×, broadband noise floor | Normal running |

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

## How the first look is scored

`physics/likelihood.py`. For every line any hypothesis predicts (its tones in the
raw spectrum; its impact rates, their second harmonics and their 1× sidebands in
the envelope spectrum), the capture's line height is
`log10(peak within the tolerance / median of the spectrum around it)`. Each
hypothesis is simulated at the capture's speed and noise, the same heights are
read from every simulation, and the capture is scored with a Student-t per line.

| Constant | Value | Where it comes from |
|---|---|---|
| `LINE_TOLERANCE` | ±2 % of the line | Measured ball-pass frequencies run "generally 1-2 % in deviation from the theoretical calculated frequencies" because rolling elements slip (Sawalhi, *J. Vibroengineering* 20(3):1322, 2018). The band covers the top of that range. |
| `SEVERITY_GRID` | 0.25, 0.5, 0.75, 1.0, 1.5 | The severity of a fault is unknown before the diagnosis, so the likelihood averages over this span of the signature model's own severity scale instead of assuming one. A range, not a measured quantity. |
| `SEEDS_PER_SEVERITY` | 4 | Enough simulations to estimate a spread per line; at about 2.5 ms each, the first look costs about a quarter of a second. Compute budget, not physics. |
| `MODEL_MISMATCH` | 0.15 (log10; ×1.4 in amplitude) | **Assumption, not yet calibrated.** The signature model is reduced-order, and a real machine will not match its line heights more closely than this. Calibrate on development recordings (the 0.007″ CWRU files), never on the files a result is reported on. |
| `STUDENT_T_DOF` | 4 | **Judgement call.** Heavy tails cap what one badly modelled line can cost, so no single line decides a case. The method: Lange, Little & Taylor, *JASA* 84:881, 1989. |
| `FALSE_ALARM_RATE` | 1 % per capture | **Design target.** A noise-only bin's power over the median exceeds x with probability exp(−x ln 2); the largest of N bins with 1 − (1 − exp(−x ln 2))^N. Solving at 1 % sets the unexplained-line threshold (about 16× the median power for 800 bins). `tests/test_likelihood.py` checks it on white noise; check it on healthy recordings before trusting it on a machine. |
| `FITS_NONE_SIGMA` | 4 σ | A reading further than this from every hypothesis' prediction fits none of them: the two-sided Gaussian tail beyond 4 σ is about 6 × 10⁻⁵. |
| `DISTINCT_SIGMA` | 1 σ | A suspect written during a case must differ from every existing hypothesis, at every severity it is simulated at, by at least this on some predicted line. Otherwise no capture could tell them apart and testing it would prove nothing, so it is refused. A design rule. |
| `BASELINE_1X` | 0.25 | The height of the normal 1× running tone in every signature. Heights are relative, so this only fixes the unit a written suspect's "4× as tall" is measured in. |
| `REJECT_BELOW` | 3 % | Display only: below it a hypothesis is shown as rejected. It stays in the distribution. |
| `CONCLUDE_ABOVE` | 80 % | The bar for a verdict. Below it the case asks for a measurement or ends "unresolved". |

What the scoring cannot do, said plainly: the line heights are relative to the
local floor, so a healthy machine and a mildly unbalanced one differ only in how
tall 1× stands, and without the machine's own baseline that is weak evidence.
The first look then splits between them, and the engine asks for the
measurement that separates them (a coast-down) rather than guess.

## Predicted values in the test catalogue

`investigation/catalog.py` holds what each hypothesis predicts for each
measurable feature. These are first-pass priors drawn from the table above.

**They are not yet calibrated against the rig.** Week 2 of `docs/TASKS.md`
replaces them with values measured from induced faults, three runs each, and the
commit that does it must show the before/after diagnosis accuracy. Until then,
treat them as a documented guess, and say so if a judge asks.

`sigma` on each test is the measurement noise in the same units. It is what
makes the expected-information-gain calculation meaningful: a test that separates
two hypotheses by 0.1 with a sigma of 0.3 is worthless, and the engine will not
choose it.

## Faults we deliberately do not induce on the bench

A real race spall cannot be faked on a desk rig without destroying a bearing and
still would not be repeatable. Bearing faults therefore come from CWRU
recordings, and the rig covers imbalance, misalignment, looseness and rub. Say
this plainly in the pitch; it is a strength, not a gap.
