"""A phone scan as the reading an investigation asked for.

A scan holds two sensors, and each can stand in for some of the checks the
investigation requests (`investigation.catalog`):

* **The microphone** answers the envelope check. `env_contrast` is the log ratio
  of the outer- and inner-race lines in the envelope of the 1.5 to 5 kHz band
  (`signals.features`), scale-free by design, and a phone records that band
  (phone microphones lose little above 200 Hz, IEEE 7449545). It is read with
  the same code a sensor capture is read with, at the case's speed and on the
  case's bearing.
* **The camera** answers the two checks that read a ratio of shaft lines:
  `ratio_2x_1x` (the 10 s capture) and `amp_half_x` (the half-order screen),
  both relative to 1x. The camera measures displacement and those checks ask
  for an accelerometer; for a line at frequency f acceleration is (2 pi f)^2
  times displacement, so a ratio of order k to 1x reads k^2 times higher in
  acceleration. That factor is exact for a sinusoid and is applied here.

Temperature and the coast-down are refused: a camera and a microphone cannot
measure them.

Every reading carries its own uncertainty, worked out from the clip, and goes
in through the same door as any other (`Investigation.apply_outcome`), which
widens every prediction by it; beliefs still move only in the engine.

* Sound: the clip is cut into segments, each read the same way; the spread of
  the segments over the square root of their number is the standard error of
  the whole-clip value.
* Camera: the noise around each line (a noise-only bin's magnitude is Rayleigh,
  with median sigma * sqrt(2 ln 2)) propagated through the ratio, plus the
  shutter, which averages motion over the exposure and so softens a faster line
  more than a slower one: a box exposure of 1/fps, the longest a frame allows,
  scales a line by sinc(f / fps).

Common to both: the scan's confirmed speed must agree with the case's within
the order-tracking window (`signals.features.SPEED_SEARCH_FRACTION`), because
the scan is only evidence about this machine running as the case found it.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import numpy as np

from ..investigation.catalog import BY_ID
from ..models import MachineSpec, Observation
from ..signals.features import ENVELOPE_BAND_HZ, SPEED_SEARCH_FRACTION, extract
from .scan import CANDIDATE_PROMINENCE

#: The checks the camera can answer, and the shaft order each compares with 1x.
CAMERA_ORDER: dict[str, float] = {"vib_10s": 2.0, "half_order": 0.5}

#: The check the microphone can answer.
SOUND_TEST = "envelope"

#: Why the other checks cannot come from a phone scan.
REFUSED: dict[str, str] = {
    "temperature": "a housing temperature is read with a thermometer, not a phone",
    "coast_down": "a coast-down needs the machine stopped while a sensor records the run-down",
}

#: A noise-only bin's magnitude is Rayleigh distributed; its median is
#: sigma * sqrt(2 ln 2), so the median floor divided by this is the noise's sigma.
RAYLEIGH_MEDIAN = math.sqrt(2.0 * math.log(2.0))

#: The 1x line must stand this many times above its floor: the same bar a speed
#: candidate has to clear, which is the one order tracking sets for a shaft peak.
MIN_1X_PROMINENCE = CANDIDATE_PROMINENCE

#: Sound is read in segments this long to see how much the value wanders within
#: the clip. Two seconds resolve 0.5 Hz, far finer than the bearing lines'
#: own slip window. A design choice (docs/DOMAIN.md, "Phone readings").
SEGMENT_S = 2.0

#: Fewest segments a spread is taken from: two give one difference, three are
#: the least that say anything about a spread.
MIN_SEGMENTS = 3


class CannotAnswer(ValueError):
    """This scan cannot stand in for the requested check; the message says why."""


@dataclass(frozen=True)
class PhoneReading:
    test_id: str
    #: The check's feature, as the requested sensor capture would read it.
    value: float
    #: One standard deviation on `value`, worked out from the clip.
    uncertainty: float
    #: Which of the phone's sensors read it: "camera" or "microphone".
    sensor: str
    #: How it was read, in a few words, for the ledger.
    how: str

    def statement(self, scan_id: str) -> str:
        return f"phone scan {scan_id}, {self.sensor}: {self.how}"


def _same_speed(scan_rpm: float, case_rpm: float) -> None:
    if case_rpm <= 0 or abs(scan_rpm - case_rpm) / case_rpm > SPEED_SEARCH_FRACTION:
        raise CannotAnswer(
            f"the clip runs at {scan_rpm:.0f} rpm and the case at {case_rpm:.0f} rpm; a scan only "
            f"speaks for the machine within {SPEED_SEARCH_FRACTION:.0%} of the case's speed"
        )


def _line(analysis: Mapping[str, Any], order: float) -> Mapping[str, Any]:
    for line in analysis.get("lines", []):
        if abs(float(line["order"]) - order) < 1e-9:
            return line
    raise CannotAnswer(f"the scan has no {order:g}x line on file; analyse it again")


def _readable(line: Mapping[str, Any], fps: float) -> None:
    order = float(line["order"])
    if float(line["true_hz"]) >= fps / 2:
        raise CannotAnswer(
            f"at {fps:.0f} fps the camera folds the {order:g}x line "
            f"({float(line['true_hz']):.1f} Hz) onto a lower frequency; record in Slo-mo so it "
            "sits below half the frame rate"
        )
    if not line["clear"]:
        raise CannotAnswer(
            f"the {order:g}x line sits below the drift filter or on another shaft line at this "
            "frame rate, so it cannot be read on its own"
        )
    if float(line.get("floor", 0.0)) <= 0.0:
        raise CannotAnswer("the scan was analysed before its noise was recorded; analyse it again")


def camera_reading(test_id: str, analysis: Mapping[str, Any], case_rpm: float) -> PhoneReading:
    """A ratio of shaft lines from the camera's motion, as an accelerometer reads it."""
    fps = float(analysis["fps"])
    _same_speed(float(analysis["rpm"]), case_rpm)
    order = CAMERA_ORDER[test_id]
    one, other = _line(analysis, 1.0), _line(analysis, order)
    for line in (one, other):
        _readable(line, fps)

    a1, ak = float(one["amp"]), float(other["amp"])
    floor1 = float(one["floor"])
    if a1 < MIN_1X_PROMINENCE * floor1:
        raise CannotAnswer(
            f"the 1x line stands only {a1 / floor1:.1f} times above the noise (at least "
            f"{MIN_1X_PROMINENCE:g} is needed): hold the phone steadier or move closer"
        )

    s1 = floor1 / RAYLEIGH_MEDIAN
    sk = float(other["floor"]) / RAYLEIGH_MEDIAN
    gain = order**2  # acceleration over displacement, order k against 1x
    seen = ak / a1
    value = gain * seen
    noise = gain * math.hypot(sk / a1, ak * s1 / a1**2)
    soften = float(np.sinc(float(other["true_hz"]) / fps) / np.sinc(float(one["true_hz"]) / fps))
    sigma = math.hypot(noise, value * abs(1.0 - soften))
    how = (
        f"{order:g}x/1x in displacement {seen:.3f} at {fps:.0f} fps; as an accelerometer reads "
        f"it (x{gain:g}) {value:.3f} +/- {sigma:.3f} from the clip's noise and shutter"
    )
    return PhoneReading(test_id, value, sigma, "camera", how)


def _contrast(audio: np.ndarray, fs: float, machine: MachineSpec, rpm: float) -> float:
    found = extract(Observation(machine.machine_id, audio, fs, rpm, source="phone"), machine)
    contrast = found.env_contrast()
    if contrast is None:
        raise CannotAnswer("the sound has no envelope band to read")
    return contrast


def sound_reading(
    audio: np.ndarray | None,
    fs: float,
    machine: MachineSpec,
    case_rpm: float,
    scan_rpm: float,
) -> PhoneReading:
    """The envelope check from the scan's sound, on the case's bearing at its speed."""
    _same_speed(scan_rpm, case_rpm)
    if audio is None or len(audio) == 0:
        raise CannotAnswer("this video has no sound track; record again with sound on")
    if fs / 2 < ENVELOPE_BAND_HZ[1]:
        raise CannotAnswer(
            f"the sound is sampled at {fs:.0f} Hz, too slow for the {ENVELOPE_BAND_HZ[0]:.0f} to "
            f"{ENVELOPE_BAND_HZ[1]:.0f} Hz band the envelope check reads"
        )
    x = np.asarray(audio, dtype=float)
    step = int(SEGMENT_S * fs)
    n = len(x) // step
    if n < MIN_SEGMENTS:
        raise CannotAnswer(
            f"the sound is {len(x) / fs:.1f} s long; at least {MIN_SEGMENTS * SEGMENT_S:g} s is "
            "needed to tell how much the reading wanders"
        )
    parts = [_contrast(x[i * step : (i + 1) * step], fs, machine, case_rpm) for i in range(n)]
    value = _contrast(x[: n * step], fs, machine, case_rpm)
    sigma = float(np.std(parts, ddof=1) / math.sqrt(n))
    how = (
        f"env_contrast {value:.3f} +/- {sigma:.3f} from {n * SEGMENT_S:g} s of sound at "
        f"{fs:.0f} Hz, the spread of {n} {SEGMENT_S:g} s segments; bearing {machine.bearing.label}"
    )
    return PhoneReading(SOUND_TEST, value, sigma, "microphone", how)


def refusal(test_id: str) -> str | None:
    """Why a phone scan cannot answer `test_id`, or None when it might."""
    if test_id not in BY_ID:
        return f"there is no check called {test_id}"
    if test_id in CAMERA_ORDER or test_id == SOUND_TEST:
        return None
    reason = REFUSED.get(test_id, "a phone scan cannot measure it")
    return f"a phone scan cannot answer {BY_ID[test_id].name.lower()}: {reason}"
