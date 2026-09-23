"""Deterministic stand-ins for the model layer.

These keep the product demonstrable with no network: same interfaces, templated
language, no invention. When a key is present the real adapters take over.
"""

from __future__ import annotations

from .protocols import GateVerdict


class TemplateNarrator:
    name = "offline-template"

    def explain(self, prompt: str, context: dict) -> str:
        leader = context.get("leader")
        corr = context.get("correlation")
        rival = context.get("runner_up")
        if prompt == "why_this_hypothesis" and leader:
            bits = [f"{leader} reproduces the measured spectrum"]
            if corr is not None:
                bits.append(f"at a correlation of {corr:.2f}")
            if rival:
                bits.append(f"and beats {rival}, which predicts a different shape")
            return " ".join(bits) + "."
        if prompt == "why_this_test":
            return (
                f"{context.get('test', 'The next measurement')} separates the survivors "
                f"by {context.get('spread', 0):.1f} sigma for "
                f"{context.get('effort_min', 0):.0f} technician-minutes and no downtime."
            )
        return context.get("fallback", "")


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
