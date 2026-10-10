"""Analytical fault frequencies.

These are textbook formulas. They are deterministic, cheap and checkable by hand,
which is exactly why the credibility of the whole product rests here rather than
on a learned surrogate. See docs/DOMAIN.md for the derivations and references.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from ..models import BearingGeometry


def shaft_hz(rpm: float) -> float:
    """Shaft rotational frequency, often written 1x."""
    return rpm / 60.0


@dataclass(frozen=True)
class FaultFrequencies:
    """All in Hz, for one shaft speed."""

    shaft: float
    ftf: float  # cage / fundamental train frequency
    bpfo: float  # ball pass frequency, outer race
    bpfi: float  # ball pass frequency, inner race
    bsf: float  # ball spin frequency (1x; defects usually show at 2x BSF)

    @property
    def bsf_2x(self) -> float:
        return 2.0 * self.bsf

    def as_dict(self) -> dict[str, float]:
        return {
            "1x": self.shaft,
            "2x": 2 * self.shaft,
            "3x": 3 * self.shaft,
            "ftf": self.ftf,
            "bpfo": self.bpfo,
            "bpfi": self.bpfi,
            "bsf": self.bsf,
            "2xbsf": self.bsf_2x,
        }


def bearing_multipliers(geometry: BearingGeometry) -> dict[str, float]:
    """Fault frequencies expressed as multiples of shaft speed.

    Manufacturers publish these per bearing; we derive them from geometry so that
    a new machine only needs its bearing dimensions, not a lookup table.
    """
    n = geometry.n_rolling_elements
    d = geometry.ball_diameter_mm
    big_d = geometry.pitch_diameter_mm
    cos_a = math.cos(math.radians(geometry.contact_angle_deg))
    ratio = (d / big_d) * cos_a

    return {
        "ftf": 0.5 * (1.0 - ratio),
        "bpfo": (n / 2.0) * (1.0 - ratio),
        "bpfi": (n / 2.0) * (1.0 + ratio),
        "bsf": (big_d / (2.0 * d)) * (1.0 - ratio**2),
    }


def fault_frequencies(geometry: BearingGeometry, rpm: float) -> FaultFrequencies:
    """Fault frequencies in Hz at a given shaft speed."""
    fr = shaft_hz(rpm)
    m = bearing_multipliers(geometry)
    return FaultFrequencies(
        shaft=fr,
        ftf=m["ftf"] * fr,
        bpfo=m["bpfo"] * fr,
        bpfi=m["bpfi"] * fr,
        bsf=m["bsf"] * fr,
    )


#: The bearing frequencies an unexplained periodic impact is compared against, and
#: the part each points to. A rolling-element defect strikes both races once per
#: spin, so it shows at twice the ball-spin frequency (docs/DOMAIN.md).
KINEMATIC_PARTS: dict[str, str] = {
    "ftf": "cage",
    "bsf": "rolling element",
    "2xbsf": "rolling element",
    "bpfo": "outer race",
    "bpfi": "inner race",
}


@dataclass(frozen=True)
class KinematicMatch:
    """A bearing frequency, or one of its harmonics, that an observed line sits on."""

    frequency: str  # a key of KINEMATIC_PARTS
    harmonic: int  # 1 is the frequency itself
    order: float  # the frequency, as a multiple of shaft speed
    deviation: float  # observed / predicted - 1

    @property
    def part(self) -> str:
        return KINEMATIC_PARTS[self.frequency]


def kinematic_matches(
    order: float, geometry: BearingGeometry, tolerance: float, max_harmonic: int = 3
) -> list[KinematicMatch]:
    """Which bearing frequencies an observed line, in shaft orders, could be.

    Closest first. `tolerance` is fractional: rolling elements slip, so real
    lines sit a percent or two off the formula. Twice the ball-spin frequency is
    listed as its own entry rather than as the second harmonic of the spin.
    """
    m = bearing_multipliers(geometry)
    bases = {
        "ftf": (m["ftf"], max_harmonic),
        "bsf": (m["bsf"], 1),
        "2xbsf": (2.0 * m["bsf"], max_harmonic),
        "bpfo": (m["bpfo"], max_harmonic),
        "bpfi": (m["bpfi"], max_harmonic),
    }
    found = []
    for name, (base, harmonics) in bases.items():
        for k in range(1, harmonics + 1):
            target = k * base
            deviation = order / target - 1.0
            if abs(deviation) <= tolerance:
                found.append(KinematicMatch(name, k, round(target, 4), round(deviation, 4)))
    return sorted(found, key=lambda match: abs(match.deviation))
