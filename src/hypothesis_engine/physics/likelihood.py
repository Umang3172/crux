"""How well each suspect explains the capture, as a likelihood built by simulation.

For one suspect the simulator renders many captures — several fault severities,
several seeds, at this machine's speed and at the capture's own noise level —
and the same measurement that reads the real capture reads every one of them.
The spread of those simulated measurements is the suspect's prediction; the
real capture is scored against it. This is the synthetic-likelihood idea
(Wood, Nature 2010; Price et al., J. Comput. Graph. Stat. 2018), used here to
choose between a handful of physical models rather than to fit one.

Why not a correlation of spectra: a correlation can only reward peaks that line
up. It cannot credit a suspect for correctly predicting that a peak is *absent*,
and absence is exactly what separates a healthy machine, or an unbalanced one,
from a bearing fault.

What is measured are the lines the suspects themselves predict, in multiples of
shaft speed: each tone in the raw spectrum, and each impact rate, its second
harmonic and its shaft-speed sidebands in the envelope spectrum. Each line is
read as its height above the local floor, so a predicted line that is not there
reads near zero and counts against the suspect that predicted it.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, replace
from functools import lru_cache
from typing import Literal

import numpy as np
from scipy import stats

from ..signals.features import envelope_spectrum, magnitude_spectrum
from .signatures import Signature
from .synth import synthesize

#: How far a real line may sit from its calculated frequency, as a fraction of
#: that frequency. Rolling elements slip, and measured ball-pass frequencies run
#: "generally 1-2 % in deviation from the theoretical calculated frequencies"
#: (Sawalhi, J. Vibroengineering 20(3):1322, 2018). The band covers the top of
#: that range.
LINE_TOLERANCE = 0.02

#: Allowance for the simulator being a reduced-order model, in log10 units of a
#: line's height above its floor (0.15 is a factor of about 1.4). A modelling
#: assumption, not a fit; see docs/DOMAIN.md.
MODEL_MISMATCH = 0.15

#: Degrees of freedom of the Student-t each line is scored with. Heavy tails cap
#: what one badly modelled line can cost, so no single line decides a case
#: (robust t-modelling: Lange, Little & Taylor, JASA 84:881, 1989). The value is
#: a judgement call, documented in docs/DOMAIN.md.
STUDENT_T_DOF = 4.0

#: Fault severities a suspect is simulated at. Severity is unknown before the
#: diagnosis, so the likelihood averages over this range rather than assuming one.
SEVERITY_GRID: tuple[float, ...] = (0.25, 0.5, 0.75, 1.0, 1.5)

#: Simulated captures per severity. Seeds are fixed so the result is reproducible.
SEEDS_PER_SEVERITY = 4
_SEED_BASE = 9_000

#: False-alarm rate of the unexplained-line check, per capture. See
#: `unexplained_envelope_line`.
FALSE_ALARM_RATE = 0.01

#: Envelope frequencies the unexplained-line check scans. Below a third of shaft
#: speed and above 400 Hz there is nothing a suspect here predicts.
_ENVELOPE_SCAN_MAX_HZ = 400.0


@dataclass(frozen=True)
class Line:
    """A spectral line a suspect predicts, in multiples of shaft speed."""

    band: Literal["raw", "envelope"]
    order: float

    def label(self) -> str:
        where = "envelope" if self.band == "envelope" else "spectrum"
        return f"{self.order:.3g}x in the {where}"


def predicted_lines(signature: Signature, shaft_hz: float) -> set[Line]:
    """The lines one suspect says should be there."""
    lines: set[Line] = set()
    for tone in signature.tones:
        lines.add(Line("raw", round(tone.freq_hz / shaft_hz, 4)))
    for train in signature.impacts:
        rate = train.rate_hz / shaft_hz
        lines.add(Line("envelope", round(rate, 4)))
        lines.add(Line("envelope", round(2 * rate, 4)))
        if train.modulation_hz:
            side = train.modulation_hz / shaft_hz
            lines.add(Line("envelope", round(rate - side, 4)))
            lines.add(Line("envelope", round(rate + side, 4)))
    return lines


def evidence_lines(signatures: Iterable[Signature], shaft_hz: float) -> tuple[Line, ...]:
    """Every line any live suspect predicts: the features the case is scored on."""
    union: set[Line] = set()
    for signature in signatures:
        union |= predicted_lines(signature, shaft_hz)
    return tuple(sorted(union, key=lambda line: (line.band, line.order)))


# ------------------------------------------------------------------ measuring


def _window(freqs: np.ndarray, centre: float, half: float) -> np.ndarray:
    # At least one bin either side, so a line is found even when the
    # tolerance is narrower than the frequency resolution.
    half = max(half, 1.5 * (freqs[1] - freqs[0]))
    return (freqs >= centre - half) & (freqs <= centre + half)


def line_height(freqs: np.ndarray, mag: np.ndarray, hz: float) -> float:
    """log10 of a line's peak over the local floor around it (0 = not there)."""
    peak_sel = _window(freqs, hz, LINE_TOLERANCE * hz)
    floor_sel = _window(freqs, hz, max(0.25 * hz, 5.0)) & ~peak_sel & (freqs > 1.0)
    if not np.any(peak_sel) or not np.any(floor_sel):
        return 0.0
    floor = float(np.median(mag[floor_sel])) + 1e-15
    return math.log10(max(float(mag[peak_sel].max()) / floor, 1.0))


#: The band envelope analysis demodulates (`signals.features.envelope_spectrum`).
_ENVELOPE_BAND_HZ = (1_500.0, 5_000.0)


def envelope_visible(fs: float) -> bool:
    """Whether a capture at `fs` contains any of the resonance band at all.

    A 2 kHz sensor cannot see a 1.5-5 kHz resonance; its "envelope" would be the
    raw spectrum under another name, so envelope lines are left out entirely.
    """
    return min(_ENVELOPE_BAND_HZ[1], fs / 2.0 * 0.99) > _ENVELOPE_BAND_HZ[0]


def measure_lines(
    waveform: np.ndarray, fs: float, shaft_hz: float, lines: Sequence[Line]
) -> np.ndarray:
    """The height of each line in one capture, in the order given.

    NaN for a line this capture cannot show: above Nyquist, or in the envelope
    when the resonance band is out of reach. `log_likelihood` skips those.
    """
    raw_f, raw_m = magnitude_spectrum(waveform, fs)
    env = envelope_spectrum(waveform, fs) if envelope_visible(fs) else None
    nyquist = fs / 2.0
    out = np.full(len(lines), np.nan)
    for i, line in enumerate(lines):
        hz = line.order * shaft_hz
        if hz <= 0 or hz >= nyquist:
            continue
        if line.band == "raw":
            out[i] = line_height(raw_f, raw_m, hz)
        elif env is not None:
            out[i] = line_height(env[0], env[1], hz)
    return out


def noise_level(waveform: np.ndarray, fs: float, shaft_hz: float) -> float:
    """The capture's broadband noise, in the units of `Signature.noise`.

    The median of the raw spectrum above the sixth shaft harmonic is mostly
    floor: lines and a resonance hump cover a small share of those bins. It is
    converted to the standard deviation of white noise that would give the
    same median, so the simulator can be run at the capture's own noise.
    """
    freqs, mag = magnitude_spectrum(waveform, fs)
    band = (freqs >= 6 * shaft_hz) & (freqs <= 0.9 * fs / 2.0)
    return float(np.median(mag[band])) / _unit_noise_median(fs, len(waveform), round(shaft_hz, 1))


@lru_cache(maxsize=64)
def _unit_noise_median(fs: float, n: int, shaft_hz: float) -> float:
    rng = np.random.default_rng(_SEED_BASE)
    medians = []
    for _ in range(4):
        freqs, mag = magnitude_spectrum(rng.normal(0.0, 1.0, n), fs)
        band = (freqs >= 6 * shaft_hz) & (freqs <= 0.9 * fs / 2.0)
        medians.append(float(np.median(mag[band])))
    return float(np.mean(medians))


# ------------------------------------------------------------------ predicting


@dataclass(frozen=True)
class Prediction:
    """What one suspect predicts for the features, per simulated severity."""

    means: tuple[np.ndarray, ...]
    scales: tuple[np.ndarray, ...]


@lru_cache(maxsize=2048)
def _simulated(
    signature: Signature, fs: float, n: int, seed: int, lines: tuple[Line, ...], shaft_hz: float
) -> np.ndarray:
    waveform = synthesize(signature, fs, n / fs, seed=seed)
    return measure_lines(waveform, fs, shaft_hz, lines)


def predict(
    signature_at: Callable[[float | None], Signature],
    severities: Sequence[float | None],
    fs: float,
    n: int,
    noise: float,
    lines: tuple[Line, ...],
    shaft_hz: float,
) -> Prediction:
    """Simulate a suspect over its severities and summarise what it predicts.

    `signature_at(severity)` builds the suspect's signature; `None` means the
    suspect has no severity (a healthy machine).
    """
    means, scales = [], []
    for severity in severities:
        signature = replace(signature_at(severity), noise=noise)
        rows = np.array(
            [
                _simulated(signature, fs, n, _SEED_BASE + 31 * k, lines, shaft_hz)
                for k in range(SEEDS_PER_SEVERITY)
            ]
        )
        means.append(rows.mean(axis=0))
        scales.append(np.sqrt(rows.var(axis=0, ddof=1) + MODEL_MISMATCH**2))
    return Prediction(tuple(means), tuple(scales))


def log_likelihood(observed: np.ndarray, prediction: Prediction) -> float:
    """log p(observed lines | suspect), averaged over the suspect's severities.

    Lines the capture cannot show (NaN) are left out, for every suspect alike.
    """
    per_severity = []
    for mu, scale in zip(prediction.means, prediction.scales, strict=True):
        seen = np.isfinite(observed) & np.isfinite(mu)
        logpdf = stats.t.logpdf(observed[seen], STUDENT_T_DOF, loc=mu[seen], scale=scale[seen])
        per_severity.append(float(np.sum(logpdf)))
    best = max(per_severity)
    return best + math.log(np.mean(np.exp(np.array(per_severity) - best)))


# ------------------------------------------------------------------ what nobody explains


@dataclass(frozen=True)
class Unexplained:
    """The strongest envelope line a suspect does not account for."""

    order: float
    hz: float
    power_over_median: float
    threshold: float
    strongest_explained: float


def false_alarm_threshold(n_bins: int, rate: float = FALSE_ALARM_RATE) -> float:
    """Power-over-median a noise-only bin exceeds with probability `rate` per capture.

    For noise, the power in a spectral bin is close to exponentially
    distributed, so its ratio to the median exceeds x with probability
    exp(-x ln 2). The largest of N bins exceeds x with probability
    1 - (1 - exp(-x ln 2))^N; solving for x at the chosen rate gives the line.
    Envelope spectra of real machines are not exactly noise-like, so this rate
    is a design target to be checked on healthy recordings, not a guarantee.
    """
    per_bin = 1.0 - (1.0 - rate) ** (1.0 / max(n_bins, 1))
    return -math.log(per_bin) / math.log(2.0)


def _explains(order: float, explained: set[Line], max_harmonic: int = 12) -> bool:
    candidates = [float(k) for k in range(1, max_harmonic + 1)]
    for line in explained:
        if line.band != "envelope":
            continue
        for k in range(1, 7):
            candidates += [k * line.order, k * line.order - 1.0, k * line.order + 1.0]
    return any(abs(order - c) <= LINE_TOLERANCE * max(c, 1.0) for c in candidates if c > 0)


def unexplained_envelope_line(
    waveform: np.ndarray, fs: float, shaft_hz: float, explained: set[Line]
) -> Unexplained | None:
    """The strongest periodic impact rate in the capture that `explained` lacks.

    Shaft harmonics, and harmonics and 1x sidebands of every explained envelope
    line, count as explained. Returns None when nothing unexplained clears the
    false-alarm threshold, or when the capture cannot see the resonance band.
    """
    if not envelope_visible(fs):
        return None
    freqs, mag = envelope_spectrum(waveform, fs)
    scan = (freqs >= shaft_hz / 3.0) & (freqs <= min(_ENVELOPE_SCAN_MAX_HZ, 0.9 * fs / 2.0))
    f, power = freqs[scan], mag[scan] ** 2
    if f.size < 3:
        return None
    ratio = power / (float(np.median(power)) + 1e-30)
    threshold = false_alarm_threshold(int(f.size))
    peaks = [
        i for i in range(1, f.size - 1) if ratio[i] >= ratio[i - 1] and ratio[i] >= ratio[i + 1]
    ]
    explained_heights = [ratio[i] for i in peaks if _explains(f[i] / shaft_hz, explained)]
    strongest_explained = max(explained_heights, default=0.0)
    for i in sorted(peaks, key=lambda i: ratio[i], reverse=True):
        if ratio[i] < threshold:
            return None
        order = f[i] / shaft_hz
        if not _explains(order, explained):
            return Unexplained(
                order=round(float(order), 3),
                hz=round(float(f[i]), 2),
                power_over_median=round(float(ratio[i]), 1),
                threshold=round(threshold, 1),
                strongest_explained=round(float(strongest_explained), 1),
            )
    return None
