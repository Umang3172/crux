"""Score a simulated signal against the real one.

Two comparisons, not one, because the two fault families live in different
places:

* **Shaft-order faults** (imbalance, misalignment, looseness) show in the raw
  spectrum at multiples of running speed.
* **Bearing faults** show as impacts modulating a resonance — almost invisible in
  the raw spectrum at low frequency, obvious in the *envelope* spectrum.

Comparing only the raw spectrum scores imbalance at 0.99 against an outer-race
signal, which is exactly the failure mode this product exists to avoid. So the
score is the mean of a raw-spectrum correlation and an envelope correlation.

Both are band-limited, log-compressed peak-hold spectra: explainable, and
reproducible in a spreadsheet.
"""

from __future__ import annotations

import numpy as np

from ..signals.features import envelope_available, envelope_spectrum, magnitude_spectrum


def _binned_log(freqs: np.ndarray, mag: np.ndarray, f_max: float, bin_hz: float) -> np.ndarray:
    mask = freqs <= f_max
    freqs, mag = freqs[mask], mag[mask]
    edges = np.arange(0.0, f_max + bin_hz, bin_hz)
    idx = np.digitize(freqs, edges) - 1
    binned = np.zeros(len(edges) - 1)
    for b in range(len(binned)):
        sel = idx == b
        if np.any(sel):
            binned[b] = mag[sel].max()  # peak-hold: diagnosis cares about peaks
    return np.log1p(binned / (binned.max() + 1e-12))


def _corr(a: np.ndarray, b: np.ndarray) -> float:
    if a.std() < 1e-9 or b.std() < 1e-9:
        return 0.0
    r = float(np.corrcoef(a, b)[0, 1])
    return 0.0 if np.isnan(r) else max(0.0, min(1.0, r))


def raw_spectrum_correlation(
    real: np.ndarray,
    simulated: np.ndarray,
    fs: float,
    f_max: float = 500.0,
    bin_hz: float = 2.0,
) -> float:
    """Shape agreement at shaft orders."""
    a = _binned_log(*magnitude_spectrum(real, fs), f_max, bin_hz)
    b = _binned_log(*magnitude_spectrum(simulated, fs), f_max, bin_hz)
    return _corr(a, b)


def envelope_correlation(
    real: np.ndarray,
    simulated: np.ndarray,
    fs: float,
    f_max: float = 400.0,
    bin_hz: float = 2.0,
) -> float:
    """Shape agreement in the demodulated band, where bearing defects live."""
    a = _binned_log(*envelope_spectrum(real, fs), f_max, bin_hz)
    b = _binned_log(*envelope_spectrum(simulated, fs), f_max, bin_hz)
    return _corr(a, b)


def spectral_correlation(
    real: np.ndarray,
    simulated: np.ndarray,
    sample_rate_hz: float,
    f_max: float = 500.0,
    bin_hz: float = 2.0,
    envelope_weight: float = 0.5,
) -> float:
    """The number the investigation uses: raw and envelope agreement, averaged.

    `envelope_weight` is how much of the verdict comes from the demodulated band.
    At 0.5 a hypothesis has to get both the shaft orders *and* the impact
    structure right to score well.
    """
    raw = raw_spectrum_correlation(real, simulated, sample_rate_hz, f_max, bin_hz)
    if not envelope_available(sample_rate_hz):
        return raw  # no envelope to compare; the raw spectrum is all the evidence there is
    env = envelope_correlation(real, simulated, sample_rate_hz, min(f_max, 400.0), bin_hz)
    return float((1.0 - envelope_weight) * raw + envelope_weight * env)
