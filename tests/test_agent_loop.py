"""The investigator loop in the agent framework, run offline.

A scripted stand-in model drives the case through the same tools Gemini gets,
so the loop, the gate and the finish are exercised with no network and no keys.
What a real Gemini model says is not tested here; that it cannot write a belief,
cannot end the loop and cannot slip an extra argument into a tool is.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator

import pytest

pytest.importorskip("google.adk")

from fastapi.testclient import TestClient  # noqa: E402
from google.adk.models import BaseLlm, LlmRequest, LlmResponse  # noqa: E402
from google.genai import types  # noqa: E402

from hypothesis_engine.agents import factory  # noqa: E402
from hypothesis_engine.agents.investigator import as_adk_tool, investigate  # noqa: E402
from hypothesis_engine.agents.scripted import ScriptedInvestigator  # noqa: E402
from hypothesis_engine.api.app import app  # noqa: E402
from hypothesis_engine.data.rig import BENCH_RIG, rig_oracle, synthetic_capture  # noqa: E402
from hypothesis_engine.models import FaultKind  # noqa: E402
from hypothesis_engine.tools import (  # noqa: E402
    InMemoryCaseStore,
    InvestigatorTools,
    open_case,
    record_measurement,
)

# An inner-race fault of moderate strength under heavy noise: the first look
# cannot place it, and a requested capture can.
AMBIGUOUS = {"severity": 0.5, "extra_noise": 0.45, "seed": 555}

#: The rig's honest answers: new captures of the same machine in the same state.
_rig_answer = rig_oracle(
    FaultKind.INNER_RACE,
    BENCH_RIG,
    severity=AMBIGUOUS["severity"],
    extra_noise=AMBIGUOUS["extra_noise"],
)


def _case(answer=None):
    store = InMemoryCaseStore()
    obs = synthetic_capture(FaultKind.INNER_RACE, BENCH_RIG, **AMBIGUOUS)
    return store, open_case(store, BENCH_RIG, obs, answer).id


class _Talker(BaseLlm):
    """A model that only ever talks and never calls a tool."""

    model: str = "talker"

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text="Hmm.")]))


class _Overreacher(BaseLlm):
    """A model that tries to conclude while handing the tool a confidence of its own."""

    model: str = "overreacher"
    case_id: str = ""

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        answered = any(
            part.function_response is not None
            for content in llm_request.contents
            for part in content.parts or []
        )
        if answered:
            part = types.Part(text="Done.")
        else:
            call = types.FunctionCall(
                name="conclude", args={"case_id": self.case_id, "confidence": 0.99}
            )
            part = types.Part(function_call=call)
        yield LlmResponse(content=types.Content(role="model", parts=[part]))


def test_the_investigator_settles_an_ambiguous_case_through_the_tools():
    store, case_id = _case(_rig_answer)
    run = investigate(store, case_id, model=ScriptedInvestigator())

    assert run.case.status == "concluded"
    assert run.case.leader == "inner_race"
    names = [name for name, _ in run.tool_calls]
    for step in ("run_virtual_experiments", "choose_next_test", "request_measurement", "conclude"):
        assert step in names
    assert names.index("request_measurement") < names.index("conclude")
    first = run.case.requests[0]
    assert any(f"it read {first.reading:.2f}" in line for line in run.case.narration)


def test_the_investigator_writes_the_suspect_the_bearing_points_to():
    # A spalled rolling element is not in the catalogue. The physics refuses a
    # verdict over impacts no suspect predicts; the investigator matches them to
    # twice the ball-spin frequency and writes that suspect; the physics tests it.
    store = InMemoryCaseStore()
    case_id = open_case(store, BENCH_RIG, synthetic_capture("rolling_element", BENCH_RIG)).id
    run = investigate(store, case_id, model=ScriptedInvestigator())

    names = [name for name, _ in run.tool_calls]
    assert names.index("bearing_frequency_matches") < names.index("propose_suspect")
    assert names.index("propose_suspect") < names.index("conclude")
    assert "request_measurement" not in names
    assert run.case.status == "concluded"
    assert run.case.leader == "rolling_element_defect"


def test_impacts_on_no_bearing_frequency_end_unresolved_with_the_clue():
    store = InMemoryCaseStore()
    case_id = open_case(store, BENCH_RIG, synthetic_capture("unlisted_impact", BENCH_RIG)).id
    run = investigate(store, case_id, model=ScriptedInvestigator())

    names = [name for name, _ in run.tool_calls]
    assert "propose_suspect" not in names, "nothing in the kinematics supports a suspect"
    assert "request_measurement" not in names
    assert run.case.status == "unresolved"
    assert "match no frequency of this bearing" in run.case.unresolved_reason


def test_the_loop_is_ended_by_code_not_by_the_model():
    store, case_id = _case(_rig_answer)
    run = investigate(store, case_id, model=_Talker(), max_rounds=3)

    assert run.rounds == 3
    assert run.case.status == "unresolved", "the engine closed it, by its own rule"
    assert "budget of 3 rounds is spent" in run.case.unresolved_reason


class _Looper(BaseLlm):
    """A model that reads the case forever and never moves it on."""

    model: str = "looper"
    case_id: str = ""

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        call = types.FunctionCall(name="get_case", args={"case_id": self.case_id})
        yield LlmResponse(
            content=types.Content(role="model", parts=[types.Part(function_call=call)])
        )


class _Stalled(BaseLlm):
    """A model that never answers."""

    model: str = "stalled"

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        await asyncio.sleep(60)
        yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text="late")]))


def test_a_model_that_loops_is_stopped_by_its_call_budget():
    store, case_id = _case(_rig_answer)
    run = investigate(store, case_id, model=_Looper(case_id=case_id), max_model_calls=5)

    assert run.stopped == "The investigator's budget of 5 model calls is spent."
    assert sum(name == "get_case" for name, _ in run.tool_calls) == 5
    assert run.case.status == "unresolved", "closed by the engine's rule"
    assert run.stopped in run.case.unresolved_reason


def test_a_model_that_stalls_is_stopped_by_its_time_budget():
    store, case_id = _case(_rig_answer)
    run = investigate(store, case_id, model=_Stalled(), max_seconds=0.2)

    assert run.stopped == "The investigator's budget of 0.2 seconds is spent."
    assert run.case.status == "unresolved"


def test_an_undeclared_argument_never_reaches_the_engine():
    store, case_id = _case(_rig_answer)
    tools = InvestigatorTools(store)
    tools.run_virtual_experiments(case_id)
    before = tools.get_case(case_id).leader_belief

    run = investigate(store, case_id, model=_Overreacher(case_id=case_id), max_rounds=1)

    attempted = [args for name, args in run.tool_calls if name == "conclude"]
    assert attempted and attempted[0]["confidence"] == 0.99, "the model did try"
    assert run.case.leader_belief == before
    assert run.case.status == "unresolved", "no verdict below the bar, whatever the model said"


def test_a_reading_still_out_stops_the_loop_and_leaves_the_case_open():
    store, case_id = _case(answer=None)
    run = investigate(store, case_id, model=ScriptedInvestigator())

    assert run.case.status == "open"
    assert [r.status for r in run.case.requests] == ["waiting"]


def test_a_case_resumes_when_the_reading_arrives():
    store, case_id = _case(answer=None)
    first = investigate(store, case_id, model=ScriptedInvestigator())
    assert first.case.status == "open"
    request = first.case.requests[0]

    reading = _rig_answer(request.test_id)
    record_measurement(store, case_id, request.request_id, reading)
    second = investigate(store, case_id, model=ScriptedInvestigator())

    narration = second.case.narration
    assert sum(line.startswith("Simulated every suspect") for line in narration) == 1
    assert any(f"{request.test_name} read {reading:.2f}" in line for line in narration)
    # It picks the case up where it stood: the reading is in, and it moves on.
    assert second.case.requests[0].status == "answered"
    assert second.case.status != "open" or len(second.case.requests) == 2


def test_the_tools_the_model_sees_return_plain_json():
    store, case_id = _case(_rig_answer)
    tools = InvestigatorTools(store)
    for fn in (tools.get_case, tools.extract_features, tools.run_virtual_experiments):
        json.dumps(as_adk_tool(fn)(case_id))


def test_without_credentials_the_scripted_investigator_runs(monkeypatch):
    for name in (
        "GOOGLE_API_KEY",
        "GEMINI_API_KEY",
        "GOOGLE_GENAI_USE_ENTERPRISE",
        "GOOGLE_GENAI_USE_VERTEXAI",
    ):
        monkeypatch.delenv(name, raising=False)
    model, description = factory.investigator_model()
    assert isinstance(model, ScriptedInvestigator)
    assert description.startswith("offline")


def test_credentials_select_gemini_without_calling_it(monkeypatch):
    monkeypatch.delenv("GOOGLE_GENAI_USE_ENTERPRISE", raising=False)
    monkeypatch.delenv("GOOGLE_GENAI_USE_VERTEXAI", raising=False)
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    monkeypatch.setenv("GOOGLE_API_KEY", "not-a-real-key")
    model, description = factory.investigator_model()
    assert model == factory.DEFAULT_GEMINI_MODEL
    assert "API key" in description

    monkeypatch.delenv("GOOGLE_API_KEY")
    monkeypatch.setenv("GOOGLE_GENAI_USE_ENTERPRISE", "true")
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    model, description = factory.investigator_model()
    assert isinstance(model, ScriptedInvestigator)
    assert "GOOGLE_CLOUD_PROJECT" in description


def test_the_agent_replay_endpoint_runs_offline(monkeypatch):
    for name in ("GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENAI_USE_ENTERPRISE"):
        monkeypatch.delenv(name, raising=False)
    body = TestClient(app).post("/agent/replay", json={"fault": "inner_race", **AMBIGUOUS}).json()
    assert body["model"].startswith("offline")
    assert body["case"]["status"] == "concluded"
    assert any(call["tool"] == "request_measurement" for call in body["tool_calls"])


def test_the_agent_replay_runs_a_fault_the_catalogue_does_not_list(monkeypatch):
    for name in ("GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENAI_USE_ENTERPRISE"):
        monkeypatch.delenv(name, raising=False)
    body = TestClient(app).post("/agent/replay", json={"fault": "rolling_element"}).json()
    assert body["case"]["status"] == "concluded"
    assert body["case"]["leader"] == "rolling_element_defect"
