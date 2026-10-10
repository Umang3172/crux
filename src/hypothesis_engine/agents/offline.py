"""A deterministic stand-in for the measurement gate.

It keeps the coach demonstrable with no network: the same interface, fixed
rules, no invention. When a key is present the real adapter takes over.
"""

from __future__ import annotations

from .protocols import GateVerdict


class RuleGate:
    """What Jev does, done with thresholds, so the coach works offline."""

    name = "offline-rules"

    def check(self, scene: str, expected: str) -> GateVerdict:
        s = scene.lower()
        if "not visible" in s or "out of frame" in s or "blur" in s:
            return GateVerdict("unclear", 0.62, "I cannot see the sensor. Bring it into view.")
        if "off" in s and "housing" in s:
            return GateVerdict("retake", 0.71, "That is off the housing. Move it onto bare metal.")
        if "speed" in s and "varying" in s:
            return GateVerdict("placed", 0.68, "Wait for the speed to settle before we record.")
        if "holding" in s or "steady" in s:
            return GateVerdict("steady", 0.88, "Good. Hold still for ten seconds.")
        if "done" in s or "captured" in s:
            return GateVerdict("done", 0.93, "Captured. Sending it to the investigation.")
        return GateVerdict("placed", 0.55, "Place the sensor on the drive-end housing.")
