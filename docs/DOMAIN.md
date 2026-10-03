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
