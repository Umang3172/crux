"""Deterministic stand-ins for the two models: the investigator and the critic.

Each follows the instruction the real model is given as a fixed policy over what
its tools return, and narrates from tool results only.

The investigator runs the virtual experiments, reads the case, concludes when
nothing blocks a verdict, otherwise requests the measurement the physics chose,
and closes the case as unresolved when nothing on the menu can settle it. When
a verdict is blocked by impacts no suspect predicts it stops, because writing a
suspect is not its job, and the loop hands the case to the critic.

The critic writes a suspect in two situations only: the impacts sit on the
bearing's own kinematics (a rolling element, at its spin rate or at the cage
rate), or a document on file states a part at exactly that rate. Anything else
it leaves, with the clue. Open-ended suspects are the part only Gemini writes.

They are what the loop runs on without credentials, and what the agent-loop
tests drive, so the loop is exercised in CI with no network.
"""

from __future__ import annotations

import re
from collections.abc import AsyncGenerator
from typing import Any

from google.adk.models import BaseLlm, LlmRequest, LlmResponse
from google.genai import types

from ..physics.likelihood import LINE_TOLERANCE
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
            # The start of a turn: read the case as it stands now. The critic
            # may have had it in between.
            return _call(case_id, "get_case")

        name, result = last
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
        if view["status"] == "open" and not view.get("experiments_run"):
            return _call(case_id, "run_virtual_experiments")
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
            # No reading can account for an impact; only a suspect that predicts
            # it can, and writing one is the critic's job, once.
            if not view.get("critic_consulted"):
                return _say(
                    "Something in the capture is explained by no suspect on the list. "
                    "That is the critic's to look at."
                )
        elif view["leader_belief"] < view["conclude_at"]:
            return _call(case_id, "choose_next_test")
        return _call(case_id, "declare_unresolved", reason=" ".join(view["blockers"])[:600])


#: A rate a document states outright, the way the stand-in can read one. A real
#: model reads the passage; this only recognises the one phrasing.
_STATED_RATE = re.compile(r"(\d+(?:\.\d+)?) times for every turn of the main shaft")

#: What the critic asks the documents when the bearing explains nothing.
_QUESTION = (
    "another part driven from the main shaft: how many times does it strike or pass "
    "for every turn of the main shaft"
)


class ScriptedCritic(BaseLlm):
    """Offline critic: the critic's tools, a fixed policy.

    Given a case blocked by impacts no suspect predicts, it compares their rate
    with the bearing's own frequencies and writes the rolling-element suspect
    when they sit there. When they do not, it looks in the machine's documents
    for a part that states that rate and writes that suspect, with the passage.
    Anything else it leaves, with the clue. It writes at most one suspect.
    """

    model: str = "offline-scripted-critic"

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        yield self._next(llm_request)

    def _next(self, request: LlmRequest) -> LlmResponse:
        case_id = _case_id(request)
        if case_id is None:
            return _say("No case id was given, so there is nothing to look at.")
        last = _last_tool_result(request)
        if last is None:
            return _call(case_id, "bearing_frequency_matches")
        name, result = last
        if name == "bearing_frequency_matches":
            return self._after_matches(case_id, result)
        if name == "search_knowledge":
            return self._after_search(
                case_id, result, _tool_result(request, "bearing_frequency_matches")
            )
        if name == "propose_suspect":
            label = result["name"].replace("_", " ")
            if result.get("status") == "refused":
                text = f"Wrote a suspect, {label}, and the physics refused it. {' '.join(result['reasons'])}"
            else:
                text = f"Wrote a suspect the list lacks: {label}. {' '.join(result['reasons'])}"
            return _call(case_id, "narrate", text=text[:600])
        return _say("That is what the critic can add.")

    @staticmethod
    def _after_matches(case_id: str, report: dict[str, Any]) -> LlmResponse:
        """Write a suspect only where the bearing's own kinematics point to a part."""
        if report.get("unexplained") is None:
            return _say("Nothing in the capture stands in the way of a verdict.")
        parts = {m["part"]: m for m in report.get("matches") or []}
        if "rolling element" in parts or "cage" in parts:
            # A line at the cage rate alone points here too: a damaged rolling
            # element is carried in and out of the load zone once per cage turn,
            # and in some captures that line is the strongest one. The physics
            # refuses the suspect if the strikes it predicts are not there.
            orders = report["bearing_orders"]
            rate = (
                parts["rolling element"]["order"] if "rolling element" in parts else orders["2xbsf"]
            )
            suspect = {
                "name": "rolling_element_defect",
                "description": "A damaged rolling element strikes both races once per spin, so it "
                "shows at twice the ball-spin frequency, modulated as the cage carries it round.",
                "impacts": [
                    {
                        "rate_order": rate,
                        "relative_amplitude": _SUSPECT_STRENGTH,
                        "modulation_order": orders["ftf"],
                    }
                ],
            }
            return _call(case_id, "propose_suspect", suspect=suspect)
        if parts:
            # A race this bearing has, which the list already covers: nothing to add.
            return _call(case_id, "narrate", text=report["detail"][:600])
        # No part of the bearing strikes at that rate. Another part of the machine may.
        return _call(case_id, "search_knowledge", question=_QUESTION)

    @staticmethod
    def _after_search(
        case_id: str, found: dict[str, Any], report: dict[str, Any] | None
    ) -> LlmResponse:
        gap = ((report or {}).get("unexplained") or {}).get("order")
        for passage in found.get("passages") or []:
            for stated in _STATED_RATE.findall(passage["text"]):
                rate = float(stated)
                if gap is None or abs(rate - gap) > LINE_TOLERANCE * rate:
                    continue
                name = re.sub(r"[^a-z0-9]+", "_", passage["section"].lower()).strip("_")[:40]
                suspect = {
                    "name": name if re.fullmatch(r"[a-z][a-z0-9_]{2,39}", name) else "part_on_file",
                    "description": f"{passage['section']}: the machine's notes say it passes "
                    f"{stated} times for every turn of the main shaft, which is the rate of the "
                    "impacts no suspect explains.",
                    "impacts": [{"rate_order": rate, "relative_amplitude": _SUSPECT_STRENGTH}],
                    "cites": [passage["id"]],
                }
                return _call(case_id, "propose_suspect", suspect=suspect)
        documents = (
            "The machine's documents name no part at that rate."
            if found.get("passages")
            else found.get("detail", "")
        )
        clue = (
            f"{(report or {}).get('detail', '')} {documents} No bearing defect on the list "
            "explains it; look for a rub, a loose part or a gear mesh."
        )
        return _call(case_id, "narrate", text=clue.strip()[:600])


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


def _tool_result(request: LlmRequest, name: str) -> dict[str, Any] | None:
    """The latest result of one tool in this conversation, if it was called."""
    for content in reversed(request.contents):
        for part in reversed(content.parts or []):
            if part.function_response is not None and part.function_response.name == name:
                response = part.function_response.response or {}
                return response.get("result", response)
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
