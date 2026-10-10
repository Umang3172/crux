"""An investigator run, told as who asked what and what the physics answered.

Every step of a run is one tool call. Here each becomes two plain sentences:
what the model asked for, and what the tools answered. The model's own words
appear only where it narrates. Every figure comes out of a tool result, so the
trace cannot say more than the engine did.

Nothing here calls a model or moves a belief; it only describes a finished run.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Line:
    """One step, for the screen."""

    tool: str
    kind: str  # "says" when the model narrates, "asks" when it calls the physics
    asked: str
    answered: str | None


def _pct(p: float | None) -> str:
    if p is None:
        return "not yet scored"
    return ">99%" if p >= 0.995 else f"{p:.0%}"


def _name(key: str | None) -> str:
    return (key or "").replace("_", " ")


def _sentence(text: str) -> str:
    return text[:1].upper() + text[1:]


def _suspect(args: dict[str, Any]) -> str:
    """A written suspect's physics in words: its impacts and tones per shaft turn."""
    spec = args.get("suspect") or {}
    parts = []
    for impact in spec.get("impacts") or []:
        rate = impact.get("rate_order")
        if rate is not None:
            parts.append(f"impacts {float(rate):.3g} times per shaft turn")
    for tone in spec.get("tones") or []:
        order = tone.get("order")
        if order is not None:
            parts.append(f"a tone at {float(order):.3g}x shaft speed")
    what = spec.get("description") or ""
    physics = ("It would show as " + " and ".join(parts) + ".") if parts else ""
    return " ".join(x for x in (what, physics) if x)


def describe(tool: str, args: dict[str, Any], result: dict[str, Any] | None) -> Line:
    """One tool call in plain words. Unknown tools are shown by name, never hidden."""
    r = result or {}
    if tool == "narrate":
        return Line(tool, "says", str(args.get("text", "")), None)

    if tool == "run_virtual_experiments":
        asked = "Test every suspect on a virtual copy of the machine."
        if not r:
            return Line(tool, "asks", asked, None)
        if not r.get("ran", False):
            return Line(tool, "asks", asked, r.get("detail"))
        out = [_name(k) for k in r.get("rejected", [])]
        answered = f"{_name(r.get('leader')).capitalize()} leads at {_pct(r.get('leader_belief'))}."
        if out:
            answered += " Ruled out: " + ", ".join(out) + "."
        return Line(tool, "asks", asked, answered)

    if tool == "get_case":
        asked = "Read the case as it stands."
        if not r:
            return Line(tool, "asks", asked, None)
        status = r.get("status")
        if status == "concluded":
            answered = (
                f"Closed with a verdict: {_name(r.get('leader'))} at "
                f"{_pct(r.get('leader_belief'))}."
            )
        elif status == "unresolved":
            answered = f"Closed without a verdict. {r.get('unresolved_reason') or ''}".strip()
        else:
            blockers = r.get("blockers") or []
            answered = (
                _sentence(" ".join(blockers))
                if blockers
                else f"Nothing stands in the way: {_name(r.get('leader'))} is at "
                f"{_pct(r.get('leader_belief'))}."
            )
        return Line(tool, "asks", asked, answered)

    if tool == "extract_features":
        asked = "Read the features of the capture."
        obs = r.get("observations") or {}
        answered = f"Shaft at {r.get('rpm')} rpm; {len(obs)} named observations." if r else None
        return Line(tool, "asks", asked, answered)

    if tool == "bearing_frequency_matches":
        return Line(
            tool,
            "asks",
            "Compare the unexplained impact with this bearing's own frequencies.",
            r.get("detail"),
        )

    if tool == "choose_next_test":
        asked = "Ask which single measurement would settle it."
        if not r:
            return Line(tool, "asks", asked, None)
        if not r.get("available"):
            return Line(tool, "asks", asked, r.get("detail"))
        answered = (
            f"{r.get('test_name')}: {r.get('detail')}."
            if r.get("detail")
            else str(r.get("test_name"))
        )
        return Line(tool, "asks", asked, answered)

    if tool in ("request_measurement", "measurement_status"):
        req = r.get("request") or {}
        asked = (
            f"Request the measurement: {req.get('test_name') or args.get('test_id')}."
            if tool == "request_measurement"
            else "Check whether the reading has arrived."
        )
        if not r:
            return Line(tool, "asks", asked, None)
        if not r.get("ok", False):
            return Line(tool, "asks", asked, r.get("detail"))
        status = req.get("status")
        if status == "answered":
            answered = f"The reading came back: {req.get('reading'):.3g}."
        elif status == "unanswerable":
            answered = "Nobody could take it."
        else:
            answered = "Waiting for the reading."
        return Line(tool, "asks", asked, answered)

    if tool == "propose_suspect":
        spec = args.get("suspect") or {}
        asked = f"Write a new suspect, {_name(spec.get('name'))}. {_suspect(args)}".strip()
        if not r:
            return Line(tool, "asks", asked, None)
        reasons = " ".join(r.get("reasons") or [])
        status = r.get("status")
        if status == "refused":
            answered = f"Refused. {reasons}".strip()
        elif status == "pending_experiments":
            answered = f"Added; it will be simulated with the rest. {reasons}".strip()
        else:
            answered = f"Simulated and scored on all the evidence. {reasons}".strip()
        return Line(tool, "asks", asked, answered)

    if tool == "conclude":
        asked = "Ask for a verdict."
        if not r:
            return Line(tool, "asks", asked, None)
        if not r.get("ok", False):
            return Line(tool, "asks", asked, f"Not yet. {r.get('detail') or ''}".strip())
        answered = (
            f"{_name(r.get('root_cause')).capitalize()} at {_pct(r.get('confidence'))}. "
            f"{r.get('recommended_action') or ''}"
        ).strip()
        return Line(tool, "asks", asked, answered)

    if tool == "declare_unresolved":
        asked = f"Close the case without a verdict. {args.get('reason') or ''}".strip()
        return Line(tool, "asks", asked, r.get("detail") if r else None)

    return Line(tool, "asks", f"Call {tool}.", r.get("detail") if r else None)
