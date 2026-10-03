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

#: The structural resonance band bearing impacts ring, which envelope analysis
#: demodulates. See docs/DOMAIN.md, "What each fault looks like".
ENVELOPE_BAND_HZ: tuple[float, float] = (1_500.0, 5_000.0)

#: How far the true shaft speed may sit from the reported one. The CWRU set alone
#: spans 1730–1797 rpm across its loads (3.7%), and a tachometer or nameplate
#: speed can be off by the motor's slip; ±5% covers both without reaching the
#: half-order or 2x peaks. See docs/DOMAIN.md, "Order tracking".
SPEED_SEARCH_FRACTION = 0.05

#: The 1x peak must stand this many times above the spectrum's median before we
#: trust it over the reported speed. Noise-only spectral magnitudes are Rayleigh
#: distributed, so a bin exceeds k x median with probability 2^(-k^2): 1.5e-5 at
#: k = 4, small enough that noise in a ±5% window never passes for a shaft peak.
SPEED_PEAK_PROMINENCE = 4.0

#: Real bearing defect frequencies wander 1–2% from the kinematic value because
#: the rolling elements slip (Randall & Antoni, MSSP 25, 2011). Searching ±2% of
#: the target keeps the peak in the window at any speed, unlike a fixed ±3 Hz,
#: which a 3% speed error alone overshoots at BPFI.
BEARING_SLIP_FRACTION = 0.02


class EnvelopeUnavailable(ValueError):
    """The sensor cannot see the resonance band, so there is no envelope to read.

    Raised instead of returning a substitute: a raw spectrum labelled as an
    envelope looks like evidence and is not.
    """


def envelope_available(fs: float, band: tuple[float, float] = ENVELOPE_BAND_HZ) -> bool:
    """Whether a capture at `fs` contains any of the resonance band at all."""
    return min(band[1], fs / 2.0 * 0.99) > max(band[0], 1.0)


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
    band: tuple[float, float] = ENVELOPE_BAND_HZ,
) -> tuple[np.ndarray, np.ndarray]:
    """Classic envelope analysis: band-pass the resonance, then Hilbert, then FFT.

    Bearing impacts are weak at their own repetition rate but strong as amplitude
    modulation of a structural resonance, so this is where BPFO/BPFI actually show.
    Raises `EnvelopeUnavailable` when the band is above what `fs` can see.
    """
    if not envelope_available(fs, band):
        raise EnvelopeUnavailable(
            f"a {fs:.0f} Hz capture cannot see the {band[0]:.0f}–{band[1]:.0f} Hz resonance band"
        )
    nyq = fs / 2.0
    low = max(band[0], 1.0) / nyq
    high = min(band[1], nyq * 0.99) / nyq
    sos = butter(4, [low, high], btype="bandpass", output="sos")
    filtered = sosfiltfilt(sos, x)
    env = np.abs(hilbert(filtered))
    return magnitude_spectrum(env, fs)


@dataclass(frozen=True)
class SpeedEstimate:
    """The shaft speed every frequency is read against, and where it came from."""

    rpm: float
    rpm_reported: float
    from_signal: bool
    note: str = ""

    @property
    def deviation(self) -> float:
        """Fractional gap between the signal's speed and the reported one."""
        return self.rpm / self.rpm_reported - 1.0 if self.rpm_reported > 0 else 0.0


def estimate_rpm(
    freqs: np.ndarray,
    mag: np.ndarray,
    rpm_reported: float,
) -> SpeedEstimate:
    """Order tracking: find the true 1x near the reported speed.

    Each candidate bin within ±SPEED_SEARCH_FRACTION of the reported 1x is scored
    by the sum of its 1x, 2x and 3x magnitudes, so a machine whose 2x dominates
    (misalignment) still locks onto the right fundamental. The winner is refined
    with Gaussian interpolation on the log magnitudes of the three bins around it,
    which recovers a Hann-windowed peak to a small fraction of a bin. If no peak
    stands clear of the noise floor, the reported speed stands and we say so.
    """
    fr0 = shaft_hz(rpm_reported)
    if fr0 <= 0 or len(freqs) < 4:
        return SpeedEstimate(rpm_reported, rpm_reported, False, "no usable spectrum")
    df = float(freqs[1] - freqs[0])
    window = np.flatnonzero(
        (freqs >= fr0 * (1 - SPEED_SEARCH_FRACTION)) & (freqs <= fr0 * (1 + SPEED_SEARCH_FRACTION))
    )
    if len(window) < 3:
        return SpeedEstimate(
            rpm_reported, rpm_reported, False, "capture too short to resolve the shaft peak"
        )

    def at(f: float) -> float:
        i = int(round(f / df))
        return float(mag[i]) if 0 <= i < len(mag) else 0.0

    harmonic_sum = np.array([mag[i] + at(2 * freqs[i]) + at(3 * freqs[i]) for i in window])
    i = int(window[int(np.argmax(harmonic_sum))])
    # The harmonic sum picks the right region; the 1x peak itself may sit one bin over.
    i = max(1, min(len(mag) - 2, i - 1 + int(np.argmax(mag[i - 1 : i + 2]))))

    floor = float(np.median(mag[(freqs > 1.0) & (freqs < max(10 * fr0, 50.0))]) + 1e-12)
    if mag[i] < SPEED_PEAK_PROMINENCE * floor:
        return SpeedEstimate(
            rpm_reported, rpm_reported, False, "no shaft peak clear of the noise floor"
        )

    a, b, c = (float(np.log(mag[j] + 1e-12)) for j in (i - 1, i, i + 1))
    denom = a - 2 * b + c
    offset = 0.5 * (a - c) / denom if denom < 0 else 0.0
    f1 = (i + max(-0.5, min(0.5, offset))) * df
    return SpeedEstimate(f1 * 60.0, rpm_reported, True)


@dataclass
class SignalEvidence:
    """Named observations, all relative to the strongest shaft-order peak.

    The envelope fields are None when the capture cannot see the resonance band
    (`envelope_available` is False): absent evidence, never a stand-in value.
    """

    amp_1x: float
    amp_2x: float
    amp_3x: float
    amp_half_x: float
    harmonic_run: float  # energy in 3x..5x, relative
    env_bpfo: float | None
    env_bpfi: float | None
    crest_factor: float
    rms: float
    speed: SpeedEstimate | None = None
    envelope_available: bool = True

    @property
    def rpm(self) -> float | None:
        """The speed the frequencies above were read at."""
        return None if self.speed is None else self.speed.rpm

    def as_dict(self) -> dict[str, float | None]:
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
            "rpm": self.rpm,
        }

    def ratio_2x_1x(self) -> float:
        return self.amp_2x / (self.amp_1x + 1e-9)

    def env_contrast(self) -> float | None:
        """Which bearing race the envelope points at, on a stable scale.

        log10(BPFO / BPFI) in the envelope spectrum: strongly positive for an
        outer-race defect, strongly negative for an inner-race one, near zero
        when the fault is not in the bearing at all. Unlike the raw envelope
        peak, this does not depend on how hard the machine is running, which is
        what makes it usable as a prediction in the test catalogue.
        """
        if self.env_bpfo is None or self.env_bpfi is None:
            return None
        return float(np.log10((self.env_bpfo + 1.0) / (self.env_bpfi + 1.0)))


#: Features that come from the envelope, so a sensor without the band cannot report them.
ENVELOPE_FEATURES: frozenset[str] = frozenset({"env_contrast", "env_bpfo", "env_bpfi"})


def extract(observation: Observation, machine: MachineSpec) -> SignalEvidence:
    """Everything the investigator gets to see from one capture.

    Frequencies are read against the speed found in the signal (`estimate_rpm`),
    not the reported one: BPFI is 5.4x shaft speed, so a 3% speed error moves it
    by more than the width of the peak and an inner-race defect reads as healthy.
    """
    x = np.asarray(observation.waveform, dtype=float)
    fs = observation.sample_rate_hz

    freqs, mag = magnitude_spectrum(x, fs)
    speed = estimate_rpm(freqs, mag, observation.rpm)
    fr = shaft_hz(speed.rpm)
    ff = fault_frequencies(machine.bearing, speed.rpm)

    a1 = peak_near(freqs, mag, fr)
    ref = max(a1, 1e-9)

    a2 = peak_near(freqs, mag, 2 * fr) / ref
    a3 = peak_near(freqs, mag, 3 * fr) / ref
    a05 = peak_near(freqs, mag, 0.5 * fr) / ref
    run = sum(peak_near(freqs, mag, k * fr) for k in (3, 4, 5)) / (3 * ref)

    env_bpfo: float | None = None
    env_bpfi: float | None = None
    has_envelope = envelope_available(fs)
    if has_envelope:
        efreqs, emag = envelope_spectrum(x, fs)
        env_ref = float(np.median(emag[(efreqs > 5) & (efreqs < 500)]) + 1e-12)
        bin_hz = float(efreqs[1] - efreqs[0])

        def env_peak(f: float) -> float:
            return peak_near(efreqs, emag, f, tol_hz=max(BEARING_SLIP_FRACTION * f, bin_hz))

        env_bpfo = env_peak(ff.bpfo) / env_ref
        env_bpfi = env_peak(ff.bpfi) / env_ref

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
        speed=speed,
        envelope_available=has_envelope,
    )
