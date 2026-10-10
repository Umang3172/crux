"""Turn a predicted Signature into a waveform.

This is the "virtual experiment": the agent proposes a hypothesis, we synthesise
what that hypothesis would produce on *this* machine at *this* speed, and then
compare it with the real capture.

Deliberately a reduced-order signal model, not a finite-element simulation. It
reproduces the features diagnosis actually uses — shaft orders, impact trains,
resonance ringing, sidebands — and it runs in milliseconds.
"""

from __future__ import annotations

import numpy as np

from .signatures import ImpactTrain, Signature, Tone


def _tone(t: np.ndarray, tone: Tone, rng: np.random.Generator) -> np.ndarray:
    phase = rng.uniform(0, 2 * np.pi)
    return tone.amp * np.sin(2 * np.pi * tone.freq_hz * t + phase)


def _impacts(t: np.ndarray, train: ImpactTrain, fs: float, rng: np.random.Generator) -> np.ndarray:
    """An impulse train convolved with a decaying resonance."""
    out = np.zeros_like(t)
    if train.rate_hz <= 0:
        return out

    period = 1.0 / train.rate_hz
    # One ring: a damped sinusoid, long enough to decay to ~1%.
    ring_len = int(min(len(t), max(16, fs * (4.6 / train.damping))))
    tr = np.arange(ring_len) / fs
    ring = np.exp(-train.damping * tr) * np.sin(2 * np.pi * train.resonance_hz * tr)

    n_impacts = int(t[-1] / period) + 1
    for k in range(n_impacts):
        # Real bearings slip a little: 1-2% jitter keeps the model honest.
        jitter = rng.normal(0.0, 0.01 * period)
        idx = int((k * period + jitter) * fs)
        if idx < 0 or idx >= len(out):
            continue
        amp = train.amp
        if train.modulation_hz:
            # Sidebands: the defect passes in and out of the load zone.
            amp *= 0.55 + 0.45 * np.sin(2 * np.pi * train.modulation_hz * (idx / fs))
        end = min(len(out), idx + ring_len)
        out[idx:end] += amp * ring[: end - idx]
    return out


def synthesize(
    signature: Signature,
    sample_rate_hz: float = 12_000.0,
    duration_s: float = 1.0,
    seed: int = 0,
) -> np.ndarray:
    """Render a Signature as a waveform (arbitrary units)."""
    rng = np.random.default_rng(seed)
    n = int(sample_rate_hz * duration_s)
    t = np.arange(n) / sample_rate_hz

    x = np.zeros(n)
    for tone in signature.tones:
        x += _tone(t, tone, rng)
    for train in signature.impacts:
        x += _impacts(t, train, sample_rate_hz, rng)
    if signature.noise > 0:
        x += _noise(n, sample_rate_hz, signature, rng)
    return x


#: Octaves over which the noise climbs from its level near the shaft lines to
#: its level in the resonance band, when a signature gives both.
NOISE_RAMP_OCTAVES = 2.0


def _noise(n: int, fs: float, signature: Signature, rng: np.random.Generator) -> np.ndarray:
    """White noise at `signature.noise`, tilted when the signature gives a
    different level near the shaft lines (`Signature.noise_low`)."""
    white = rng.normal(0.0, signature.noise, n)
    if signature.noise_low is None:
        return white
    level, up_to = signature.noise_low
    freqs = np.fft.rfftfreq(n, d=1.0 / fs)
    # `level` up to `up_to`, `noise` from NOISE_RAMP_OCTAVES above it, and a
    # straight line between them on log axes.
    climb = np.log2(np.maximum(freqs, 1e-9) / up_to) / NOISE_RAMP_OCTAVES
    gain = (level / signature.noise) ** (1.0 - np.clip(climb, 0.0, 1.0))
    return np.fft.irfft(np.fft.rfft(white) * gain, n)
