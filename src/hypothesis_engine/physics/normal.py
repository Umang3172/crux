"""This machine's own normal.

The signature model draws a textbook machine: a running tone at 1x, a quarter
of it at 2x, and nothing else. A real machine has its own normal spectrum, and
where that differs from the textbook a healthy machine reads as a fault: a rig
whose 2x has always stood taller than its 1x looks misaligned.

When healthy captures of the same machine are on hand, a case is scored on the
*change* from them, in two steps:

* **Units.** Heights in a signature are multiples of the normal 1x running
  tone. The machine's own healthy 1x fixes that unit: the simulator's noise is
  set so that its textbook 1x stands as far above the floor as this machine's
  healthy 1x does (`noise_scale`). Without it the model's tone-to-noise ratio
  is an assumption, and the verdict would move with the sensor's units.
* **Quirks.** A tone is taken as its amplitude above the noise, in floors. What
  the machine has gained or lost at each line since it was healthy is added to
  the textbook healthy machine (`restate_lines`): amplitudes add, so a fault is
  credited with exactly what it adds, whatever the machine's own normal was.

Nothing here moves a belief; the engine scores the restated values exactly as
it scores raw ones.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from .likelihood import LineReadings

#: A healthy 1x fixes the unit only where it stands this many times above what
#: a noise-only line reads; below that its height is mostly chance.
CLEAR_TONE = 3.0

#: Named features that are a peak divided by the 1x peak. Their change from
#: normal depends on how far 1x itself has moved (`restate_reading`).
RELATIVE_TO_1X: frozenset[str] = frozenset({"ratio_2x_1x", "amp_half_x"})


def tone(heights: np.ndarray, alone: np.ndarray) -> np.ndarray:
    """The tone alone, in multiples of the floor: what a line reads beyond a
    noise-only line (`likelihood.noise_only_heights`), taken off in power."""
    return np.sqrt(np.maximum(10.0 ** (2 * heights) - 10.0 ** (2 * alone), 0.0))


def height(tones: np.ndarray, alone: np.ndarray) -> np.ndarray:
    """What a tone of that size reads on top of a noise-only line: `tone` undone."""
    return 0.5 * np.log10(tones**2 + 10.0 ** (2 * alone))


def at_todays_floor(
    then: LineReadings, floor_now: np.ndarray, alone_then: np.ndarray, alone_now: np.ndarray
) -> np.ndarray:
    """A normal capture's line heights as they would read against today's floor.

    A line's height is its peak over the local floor, so once a machine's noise
    has risen every unchanged tone reads lower. The tone is taken out of the old
    reading, rescaled from that day's floor to today's, and put back on today's
    noise. `alone_*` are noise-only heights at each capture's length.
    """
    return height(tone(then.heights, alone_then) * (then.floors / floor_now), alone_now)


def noise_scale(textbook_1x: float, own_1x: float, alone_1x: float) -> float | None:
    """How much louder the simulator's noise must run than the capture's measured
    noise for its textbook 1x to stand as clear of the floor as this machine's
    healthy 1x does. Both tones are in floors (`tone`). None when the machine's
    healthy 1x is not clear of the noise, so there is no unit to take from it."""
    if not np.isfinite(own_1x) or own_1x < CLEAR_TONE * 10.0**alone_1x:
        return None
    return textbook_1x / own_1x


@dataclass(frozen=True)
class Restated:
    """A capture's lines in the textbook machine's terms."""

    heights: np.ndarray  # the textbook healthy machine plus what this one has gained
    times_normal: np.ndarray  # each line's height today over its own normal (1 = unchanged)
    wander: np.ndarray  # how far the restated heights of its healthy captures spread


def restate_lines(
    today: LineReadings,
    normal: Sequence[np.ndarray],
    textbook: np.ndarray,
    alone: np.ndarray,
    sampling: np.ndarray,
    colour: np.ndarray,
) -> Restated:
    """Today's line heights as the textbook healthy machine plus the change from normal.

    `normal` holds each healthy capture's heights at today's floor
    (`at_todays_floor`), `textbook` what the model's healthy machine reads on
    the same lines, `alone` the noise-only heights, `sampling` the spread one
    capture has by chance, and `colour` each line's local floor over the floor at
    1x: a real machine's noise is not flat, so a gain counted in a line's own
    floors is first put in the floors the unit was fixed in.

    Only the shift is computed from tones: a line keeps its own reading, moved
    by the difference between where its tone stands on this machine and where
    the same gain would stand on the textbook one. A line with no tone on either
    machine is therefore left exactly as read, chance scatter included.

    With several healthy captures the spread is measured by restating each of
    them. With one it cannot be, and that capture's chance spread is allowed for.
    """
    then = np.asarray(normal, dtype=float)
    usual = tone(then, alone).mean(axis=0)
    reference = tone(textbook, alone)

    def restated(heights: np.ndarray) -> np.ndarray:
        own = tone(heights, alone)
        gained = (own - usual) * colour
        return heights + height(np.maximum(reference + gained, 0.0), alone) - height(own, alone)

    if len(then) > 1:
        spread = np.std([restated(h) for h in then], axis=0, ddof=1)
        wander = spread * math.sqrt(1.0 + 1.0 / len(then))
    else:
        wander = 0.5 * np.abs(restated(then[0] + sampling) - restated(then[0] - sampling))
    return Restated(restated(today.heights), 10.0 ** (today.heights - then.mean(axis=0)), wander)


def restate_reading(
    feature: str, value: float, normal: Sequence[float], textbook: float, growth_1x: float = 1.0
) -> tuple[float, float]:
    """A requested capture's feature in the textbook machine's terms, and how far
    this machine's own normal wanders.

    A feature that is a peak over the 1x peak carries the machine's own ratio
    in its numerator; once 1x has grown by `growth_1x` that share has shrunk by
    the same factor, so it is the part taken off. Any other feature is restated
    as the textbook value plus its change.
    """
    usual = float(np.mean(normal))
    wander = 0.0
    if len(normal) > 1:
        wander = float(np.std(normal, ddof=1)) * math.sqrt(1.0 + 1.0 / len(normal))
    if feature in RELATIVE_TO_1X:
        return value - (usual - textbook) / max(growth_1x, 1e-9), wander
    return textbook + (value - usual), wander
