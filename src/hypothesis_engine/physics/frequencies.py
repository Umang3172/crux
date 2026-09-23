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
