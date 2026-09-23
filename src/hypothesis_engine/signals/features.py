"""Signal scientist: turn a waveform into named, physical observations.

Note what this module does *not* return: an anomaly score. It returns evidence —
amplitudes at shaft orders, envelope peaks at bearing frequencies, crest factor —
because the investigator reasons over evidence, not over a number.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.signal import butter, hilbert, sosfiltfilt

from ..models import MachineSpec, Observation
from ..physics.frequencies import fault_frequencies, shaft_hz


def magnitude_spectrum(x: np.ndarray, fs: float) -> tuple[np.ndarray, np.ndarray]:
    """One-sided amplitude spectrum with a Hann window."""
    x = np.asarray(x, dtype=float)
    x = x - x.mean()
    win = np.hanning(len(x))
    spec = np.abs(np.fft.rfft(x * win)) * (2.0 / np.sum(win))
    freqs = np.fft.rfftfreq(len(x), d=1.0 / fs)
    return freqs, spec


def peak_near(freqs: np.ndarray, mag: np.ndarray, f0: float, tol_hz: float = 2.0) -> float:
    """Largest magnitude within +/- tol of f0 (order tracking is not perfect)."""
    if f0 <= 0:
        return 0.0
    sel = (freqs >= f0 - tol_hz) & (freqs <= f0 + tol_hz)
    return float(mag[sel].max()) if np.any(sel) else 0.0


def envelope_spectrum(
    x: np.ndarray,
    fs: float,
    band: tuple[float, float] = (1_500.0, 5_000.0),
) -> tuple[np.ndarray, np.ndarray]:
    """Classic envelope analysis: band-pass the resonance, then Hilbert, then FFT.

    Bearing impacts are weak at their own repetition rate but strong as amplitude
    modulation of a structural resonance, so this is where BPFO/BPFI actually show.
    """
    nyq = fs / 2.0
    low = max(band[0], 1.0) / nyq
    high = min(band[1], nyq * 0.99) / nyq
    if high <= low:
        return magnitude_spectrum(x, fs)
    sos = butter(4, [low, high], btype="bandpass", output="sos")
    filtered = sosfiltfilt(sos, x)
    env = np.abs(hilbert(filtered))
    return magnitude_spectrum(env, fs)


@dataclass
class SignalEvidence:
    """Named observations, all relative to the strongest shaft-order peak."""

    amp_1x: float
    amp_2x: float
    amp_3x: float
    amp_half_x: float
    harmonic_run: float  # energy in 3x..5x, relative
    env_bpfo: float
    env_bpfi: float
    crest_factor: float
    rms: float

    def as_dict(self) -> dict[str, float]:
        return {
            "amp_1x": self.amp_1x,
            "amp_2x": self.amp_2x,
            "amp_3x": self.amp_3x,
            "amp_half_x": self.amp_half_x,
            "harmonic_run": self.harmonic_run,
            "env_bpfo": self.env_bpfo,
            "env_bpfi": self.env_bpfi,
            "env_contrast": self.env_contrast(),
            "crest_factor": self.crest_factor,
            "rms": self.rms,
        }

    def ratio_2x_1x(self) -> float:
        return self.amp_2x / (self.amp_1x + 1e-9)

    def env_contrast(self) -> float:
        """Which bearing race the envelope points at, on a stable scale.

        log10(BPFO / BPFI) in the envelope spectrum: strongly positive for an
        outer-race defect, strongly negative for an inner-race one, near zero
        when the fault is not in the bearing at all. Unlike the raw envelope
        peak, this does not depend on how hard the machine is running, which is
        what makes it usable as a prediction in the test catalogue.
        """
        return float(np.log10((self.env_bpfo + 1.0) / (self.env_bpfi + 1.0)))


def extract(observation: Observation, machine: MachineSpec) -> SignalEvidence:
    """Everything the investigator gets to see from one capture."""
    x = np.asarray(observation.waveform, dtype=float)
    fs = observation.sample_rate_hz
    fr = shaft_hz(observation.rpm)
    ff = fault_frequencies(machine.bearing, observation.rpm)

    freqs, mag = magnitude_spectrum(x, fs)
    a1 = peak_near(freqs, mag, fr)
    ref = max(a1, 1e-9)

    a2 = peak_near(freqs, mag, 2 * fr) / ref
    a3 = peak_near(freqs, mag, 3 * fr) / ref
    a05 = peak_near(freqs, mag, 0.5 * fr) / ref
    run = sum(peak_near(freqs, mag, k * fr) for k in (3, 4, 5)) / (3 * ref)

    efreqs, emag = envelope_spectrum(x, fs)
    env_ref = float(np.median(emag[(efreqs > 5) & (efreqs < 500)]) + 1e-12)
    env_bpfo = peak_near(efreqs, emag, ff.bpfo, tol_hz=3.0) / env_ref
    env_bpfi = peak_near(efreqs, emag, ff.bpfi, tol_hz=3.0) / env_ref

    rms = float(np.sqrt(np.mean(x**2)))
    crest = float(np.max(np.abs(x)) / (rms + 1e-12))

    return SignalEvidence(
        amp_1x=1.0 if a1 > 0 else 0.0,
        amp_2x=a2,
        amp_3x=a3,
        amp_half_x=a05,
        harmonic_run=run,
        env_bpfo=env_bpfo,
        env_bpfi=env_bpfi,
        crest_factor=crest,
        rms=rms,
    )
