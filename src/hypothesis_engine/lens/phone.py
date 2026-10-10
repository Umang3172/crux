"""What a phone might have recorded instead of a measurement microphone: an emulation.

Kept apart from the physics and optional. The sound evaluation reports the raw
microphone and this emulation side by side, so the emulation's assumptions never
hide inside a result. It is not a model of any particular phone; a recording of
the same machine on a real phone replaces it.
"""

from __future__ import annotations

from fractions import Fraction

import numpy as np
from scipy.signal import butter, resample_poly, sosfilt

#: Rate of the emulated recording: AES5 ("Preferred sampling frequencies for
#: applications employing pulse-code modulation") recommends 48 kHz for the
#: origination, processing and interchange of programme audio.
PHONE_FS = 48_000.0

#: Phone microphones respond poorly below about 200 Hz ("Bearing fault detection
#: with the use of acoustic signals recorded by a hand-held mobile phone", IEEE
#: 7449545).
PHONE_HIGHPASS_HZ = 200.0

#: Steepness of that roll-off: an assumption, not a measurement. Fourth order
#: (-24 dB per octave) reads "hears little below 200 Hz" strictly; a measured
#: phone response replaces it.
PHONE_HIGHPASS_ORDER = 4


def emulate(
    x: np.ndarray, fs: float, snr_db: float | None = None, seed: int = 0
) -> tuple[np.ndarray, float]:
    """Resample to 48 kHz, cut below 200 Hz, optionally add white noise at `snr_db`.

    The noise level is set against the filtered signal's power, so a stated SNR
    means what a reader expects. `seed` makes the noise repeatable.
    """
    ratio = Fraction(PHONE_FS / fs).limit_denominator(1000)
    y = resample_poly(np.asarray(x, dtype=float), ratio.numerator, ratio.denominator)
    sos = butter(
        PHONE_HIGHPASS_ORDER, PHONE_HIGHPASS_HZ, btype="highpass", fs=PHONE_FS, output="sos"
    )
    y = sosfilt(sos, y)
    if snr_db is not None:
        power = float(np.mean(y**2))
        noise = np.random.default_rng(seed).normal(
            0.0, np.sqrt(power / 10 ** (snr_db / 10)), len(y)
        )
        y = y + noise
    return y, PHONE_FS
