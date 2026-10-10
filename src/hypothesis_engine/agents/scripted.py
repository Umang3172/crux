"""A deterministic stand-in for the investigator model.

It follows the instruction the real model is given as a fixed policy over what
the tools return: run the virtual experiments, read the case, conclude when
nothing blocks a verdict, otherwise request the measurement the physics chose,
and close the case as unresolved when nothing on the menu can settle it. It
narrates from tool results only. When a verdict is blocked by impacts no suspect
predicts, it writes a suspect only where the bearing's own kinematics point to a
part (a rolling element or the cage); anything else it leaves unresolved with
the clue. Open-ended suspects are the part only Gemini writes.

It is what the investigator runs on without credentials, and what the agent-loop
tests drive, so the loop is exercised in CI with no network.
"""

from __future__ import annotations

import re
from collections.abc import AsyncGenerator
from typing import Any

from google.adk.models import BaseLlm, LlmRequest, LlmResponse
from google.genai import types

from ..physics.signatures import BASELINE_1X

_CASE_ID = re.compile(r"\b(inv_[0-9a-f]+)\b")

#: A suspect is written at the catalogue's bearing-fault strength: impacts of 1.0
#: at severity 1, in units of the running 1x (docs/DOMAIN.md). Its severity is
#: averaged over the grid when it is scored, so only the order of this matters.
_SUSPECT_STRENGTH = 1.0 / BASELINE_1X


def _call(case_id: str, name: str, **args: Any) -> LlmResponse:
    call = types.FunctionCall(name=name, args={"case_id": case_id, **args})
    return LlmResponse(content=types.Content(role="model", parts=[types.Part(function_call=call)]))


def _say(text: str) -> LlmResponse:
    return LlmResponse(content=types.Content(role="model", parts=[types.Part(text=text)]))


def _pct(p: float) -> str:
    return ">99%" if p >= 0.995 else f"{p:.0%}"


class ScriptedInvestigator(BaseLlm):
    """Offline investigator: the same tools, the same rules, a fixed policy."""

    model: str = "offline-scripted-investigator"

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        yield self._next(llm_request)

    # ------------------------------------------------------------------ policy
    def _next(self, request: LlmRequest) -> LlmResponse:
        case_id = _case_id(request)
        if case_id is None:
            return _say("No case id was given, so there is nothing to investigate.")
        called = {
            part.function_call.name
            for content in request.contents
            for part in content.parts or []
            if part.function_call is not None
        }
        last = _last_tool_result(request)
        if last is None:
            if "run_virtual_experiments" not in called:
                return _call(case_id, "run_virtual_experiments")
            return _call(case_id, "get_case")

        name, result = last
        if name == "bearing_frequency_matches":
            return self._after_matches(case_id, result, called)
        if name == "propose_suspect":
            if result.get("status") == "refused":
                return _call(
                    case_id, "declare_unresolved", reason=" ".join(result["reasons"])[:600]
                )
            return _call(
                case_id,
                "narrate",
                text=f"Wrote a suspect the catalogue lacks: {result['name'].replace('_', ' ')}, "
                f"at the bearing frequency the impacts sit on. {' '.join(result['reasons'])}"[:600],
            )
        if name == "run_virtual_experiments":
            if not result.get("ran"):  # a resumed case: nothing was simulated this time
                return _call(case_id, "get_case")
            return _call(
                case_id,
                "narrate",
                text=f"Simulated every suspect against the capture: {result['leader'].replace('_', ' ')} "
                f"leads at {_pct(result['leader_belief'])}.",
            )
        if name == "get_case":
            return self._after_case(case_id, result, called)
        if name == "choose_next_test":
            if result.get("available"):
                return _call(case_id, "request_measurement", test_id=result["test_id"])
            return _call(case_id, "declare_unresolved", reason=result["detail"][:600])
        if name == "request_measurement":
            request_view = result.get("request") or {}
            if not result.get("ok"):
                return _call(case_id, "get_case")
            if request_view.get("status") == "answered":
                text = (
                    f"Asked for {request_view['test_name']}: it read {request_view['reading']:.2f}."
                )
            elif request_view.get("status") == "unanswerable":
                text = f"Asked for {request_view['test_name']}: nobody could take it."
            else:
                text = f"Asked for {request_view['test_name']}; waiting for the reading."
            return _call(case_id, "narrate", text=text)
        if name == "conclude":
            if result.get("ok"):
                return _call(
                    case_id,
                    "narrate",
                    text=f"Concluded {result['root_cause'].replace('_', ' ')} at "
                    f"{_pct(result['confidence'])}. {result['recommended_action']}",
                )
            return _call(case_id, "get_case")
        # narrate, declare_unresolved, measurement_status, propose_suspect: look again.
        return _call(case_id, "get_case")

    @staticmethod
    def _after_case(case_id: str, view: dict[str, Any], called: set[str]) -> LlmResponse:
        if view["status"] != "open":
            if view["status"] == "unresolved":
                line = f"Closed without a verdict. {view.get('unresolved_reason') or ''}"[:600]
                if not any(n.startswith("Closed without a verdict.") for n in view["narration"]):
                    return _call(case_id, "narrate", text=line.strip())
                return _say(line.strip())
            return _say(f"The case is {view['status']}.")
        waiting = [r for r in view["requests"] if r["status"] == "waiting"]
        if waiting:
            return _say(f"Waiting for the reading of {waiting[0]['test_name']}.")
        for r in view["requests"]:
            # A reading that arrived while the investigator was away is said once.
            said = f"read {r['reading']:.2f}" if r["status"] == "answered" else None
            if said and not any(r["test_name"] in n and said in n for n in view["narration"]):
                return _call(case_id, "narrate", text=f"{r['test_name']} {said}.")
        if not view["blockers"]:
            return _call(case_id, "conclude")
        if view.get("unexplained"):
            # No reading can account for an impact; only a suspect that predicts it can.
            if "bearing_frequency_matches" not in called:
                return _call(case_id, "bearing_frequency_matches")
        elif view["leader_belief"] < view["conclude_at"]:
            return _call(case_id, "choose_next_test")
        return _call(case_id, "declare_unresolved", reason=" ".join(view["blockers"])[:600])

    @staticmethod
    def _after_matches(case_id: str, report: dict[str, Any], called: set[str]) -> LlmResponse:
        """Propose a suspect only where the bearing's kinematics point to a part."""
        parts = {m["part"]: m for m in report.get("matches") or []}
        if report.get("unexplained") is None:
            return _call(case_id, "get_case")
        if "propose_suspect" not in called and "rolling element" in parts:
            suspect = {
                "name": "rolling_element_defect",
                "description": "A damaged rolling element strikes both races once per spin, so it "
                "shows at twice the ball-spin frequency, modulated as the cage carries it round.",
                "impacts": [
                    {
                        "rate_order": parts["rolling element"]["order"],
                        "relative_amplitude": _SUSPECT_STRENGTH,
                        "modulation_order": report["bearing_orders"]["ftf"],
                    }
                ],
            }
            return _call(case_id, "propose_suspect", suspect=suspect)
        if "propose_suspect" not in called and "cage" in parts:
            suspect = {
                "name": "cage_defect",
                "description": "A damaged cage strikes once per turn of the cage.",
                "impacts": [
                    {"rate_order": parts["cage"]["order"], "relative_amplitude": _SUSPECT_STRENGTH}
                ],
            }
            return _call(case_id, "propose_suspect", suspect=suspect)
        reason = (
            report["detail"] + " No bearing defect on the list explains it; look for a rub, a "
            "loose part or a gear mesh."
        )
        return _call(case_id, "declare_unresolved", reason=reason[:600])


def _case_id(request: LlmRequest) -> str | None:
    instruction = getattr(request.config, "system_instruction", None) if request.config else None
    texts = [instruction if isinstance(instruction, str) else ""]
    for content in request.contents:
        texts += [part.text or "" for part in content.parts or [] if part.text]
    for text in texts:
        found = _CASE_ID.search(text)
        if found:
            return found.group(1)
    return None


def _last_tool_result(request: LlmRequest) -> tuple[str, dict[str, Any]] | None:
    """The latest tool result in this conversation, or None if the model spoke last."""
    for content in reversed(request.contents):
        for part in reversed(content.parts or []):
            if part.function_response is not None:
                response = part.function_response.response or {}
                return part.function_response.name, response.get("result", response)
            if part.text and content.role == "model":
                return None
    return None
