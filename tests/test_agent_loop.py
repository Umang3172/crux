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
    AGENT_TOOL_NAMES,
    CRITIC_TOOL_NAMES,
    INVESTIGATOR_TOOL_NAMES,
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


def test_a_rolling_element_is_found_when_its_cage_rate_line_is_the_strongest():
    # A damaged rolling element is carried in and out of the load zone once per
    # cage turn, so the capture has a line at the cage rate too, and in about one
    # capture in ten it is the strongest thing no suspect predicts. Reading that
    # line as a cage fault ended those cases unresolved; this is one of them.
    store = InMemoryCaseStore()
    capture = synthetic_capture("rolling_element", BENCH_RIG, seed=11, extra_noise=0.45)
    case_id = open_case(store, BENCH_RIG, capture).id
    tools = InvestigatorTools(store)
    tools.run_virtual_experiments(case_id)
    first = tools.bearing_frequency_matches(case_id)
    assert [m.part for m in first.matches] == ["cage"], "the premise: the cage line leads"

    run = investigate(store, case_id, model=ScriptedInvestigator())

    assert run.case.status == "concluded"
    assert run.case.leader == "rolling_element_defect"
    assert run.case.blockers == []


def test_impacts_on_no_bearing_frequency_end_unresolved_with_the_clue():
    store = InMemoryCaseStore()
    case_id = open_case(store, BENCH_RIG, synthetic_capture("unlisted_impact", BENCH_RIG)).id
    run = investigate(store, case_id, model=ScriptedInvestigator())

    names = [name for name, _ in run.tool_calls]
    assert "propose_suspect" not in names, "nothing in the kinematics or on file supports one"
    assert "request_measurement" not in names
    assert run.case.status == "unresolved"
    # Two voices. The case's reason is the physics' own; the clue is the
    # critic's, in the narration, after it looked at the bearing and the documents.
    assert "no hypothesis on the list predicts" in run.case.unresolved_reason
    assert "match no frequency of this bearing" not in run.case.unresolved_reason
    (clue,) = [n for n in run.case.narration if "match no frequency of this bearing" in n]
    assert "The machine's documents name no part at that rate." in clue
    assert names.index("bearing_frequency_matches") < names.index("search_knowledge")


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


# ---------------------------------------------------------------- the run, as told on screen


_NO_CREDENTIALS = (
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_GENAI_USE_VERTEXAI",
    "GOOGLE_GENAI_USE_ENTERPRISE",
)


def _off_list_case():
    store = InMemoryCaseStore()
    obs = synthetic_capture("rolling_element", BENCH_RIG, seed=1, extra_noise=0.45)
    answers = rig_oracle("rolling_element", BENCH_RIG, extra_noise=0.45)
    return store, open_case(store, BENCH_RIG, obs, answers).id


def test_every_call_is_kept_with_what_the_tools_answered():
    store, case_id = _off_list_case()
    run = investigate(store, case_id, model=ScriptedInvestigator())
    assert [s.tool for s in run.steps] == [name for name, _ in run.tool_calls]
    assert all(s.result is not None for s in run.steps), "every call got its answer"
    written = next(s for s in run.steps if s.tool == "propose_suspect")
    assert written.result["status"] == "tested"
    assert written.by == "offline-scripted-investigator"


def test_a_live_model_that_cannot_be_reached_does_not_lose_the_case(monkeypatch):
    # Gemini asked for by name, with nothing to reach it by. The offline
    # investigator takes the case on, and the run says that it did and why.
    for name in _NO_CREDENTIALS:
        monkeypatch.delenv(name, raising=False)
    store, case_id = _off_list_case()
    run = investigate(store, case_id, model="gemini-3.8-flash")
    assert run.fallback is not None and "could not finish the case" in run.fallback
    assert {s.by for s in run.steps} == {"offline-scripted"}
    assert run.case.status == "concluded" and run.case.leader == "rolling_element_defect"


def test_an_offline_model_that_fails_is_a_bug_and_is_not_hidden():
    class _Broken(BaseLlm):
        model: str = "broken"

        async def generate_content_async(
            self, llm_request: LlmRequest, stream: bool = False
        ) -> AsyncGenerator[LlmResponse, None]:
            raise RuntimeError("no such policy")
            yield  # pragma: no cover

    store, case_id = _off_list_case()
    with pytest.raises(RuntimeError, match="no such policy"):
        investigate(store, case_id, model=_Broken())


def test_the_trace_says_who_asked_what_and_what_the_physics_answered(monkeypatch):
    for name in _NO_CREDENTIALS:
        monkeypatch.delenv(name, raising=False)
    body = {"fault": "rolling_element", "seed": 1, "extra_noise": 0.45}
    r = TestClient(app).post("/agent/replay", json=body).json()
    assert r["live"] is False and r["fallback"] is None
    steps = r["steps"]
    assert {s["kind"] for s in steps} == {"asks", "says"}
    told = " | ".join(f"{s['asked']} -> {s['answered']}" for s in steps)
    assert "Compare the unexplained impact with this bearing's own frequencies." in told
    assert "sit on 2xbsf x1 (rolling element)" in told
    suspect = next(s for s in steps if s["tool"] == "propose_suspect")
    assert "impacts 4.71 times per shaft turn" in suspect["asked"]
    assert suspect["answered"].startswith("Simulated and scored on all the evidence.")
    assert steps[-1]["answered"].startswith("Closed with a verdict: rolling element defect")
    # The model's own words appear only where it narrates.
    assert all(s["answered"] is None for s in steps if s["kind"] == "says")


def test_the_screen_is_told_the_tools_and_limits_from_the_code():
    about = TestClient(app).get("/agent/about").json()
    assert [t["name"] for t in about["tools"]] == list(AGENT_TOOL_NAMES)
    assert all(t["does"] for t in about["tools"]), "each tool says what it does"
    taken = {p for t in about["tools"] for p in t["takes"]}
    assert taken == {"test_id", "request_id", "suspect", "text", "reason", "question"}
    assert about["limits"] == {"rounds": 6, "model_calls": 30, "seconds": 120.0}
    off = [s["id"] for s in about["scenarios"] if not s["on_the_list"]]
    assert off == ["rolling_element", "unlisted_impact", "aux_pump"]
    # Two agents, and the tools each is given, read from the code.
    by_name = {a["name"]: a for a in about["agents"]}
    assert by_name["investigator"]["tools"] == list(INVESTIGATOR_TOOL_NAMES)
    assert by_name["critic"]["tools"] == list(CRITIC_TOOL_NAMES)
    assert all(a["job"] for a in about["agents"])


# ------------------------------------------------------------------ two agents, two jobs


def _run(fault, **capture):
    store = InMemoryCaseStore()
    case_id = open_case(store, BENCH_RIG, synthetic_capture(fault, BENCH_RIG, **capture)).id
    return store, case_id, investigate(store, case_id, model=ScriptedInvestigator())


def test_the_agent_that_can_close_a_case_cannot_write_a_suspect_and_the_reverse():
    investigator, critic = set(INVESTIGATOR_TOOL_NAMES), set(CRITIC_TOOL_NAMES)

    assert investigator | critic == set(AGENT_TOOL_NAMES), "every tool belongs to someone"
    assert not investigator & {"propose_suspect", "search_knowledge", "bearing_frequency_matches"}
    assert not critic & {
        "conclude",
        "declare_unresolved",
        "request_measurement",
        "choose_next_test",
        "run_virtual_experiments",
    }
    assert investigator & critic == {"get_case", "recall_cases", "narrate"}, (
        "both may read and speak"
    )


def test_a_part_only_the_machines_notes_know_is_found_by_the_critic_and_tested_by_the_physics():
    # A worn auxiliary pump knocks 5.7 times a turn. No hypothesis predicts it
    # and no frequency of the bearing matches it. The machine's notes name the
    # part and state its rate; the critic writes that suspect; the physics tests it.
    _, _, run = _run("aux_pump")

    by_agent = {a: [s.tool for s in run.steps if s.agent == a] for a in ("investigator", "critic")}
    assert by_agent["critic"] == [
        "bearing_frequency_matches",
        "search_knowledge",
        "propose_suspect",
        "narrate",
    ]
    assert "propose_suspect" not in by_agent["investigator"]
    assert "conclude" in by_agent["investigator"] and "conclude" not in by_agent["critic"]
    assert run.case.status == "concluded" and run.case.leader == "auxiliary_seal_flush_pump"
    (written,) = [s for s in run.case.suspects if s.origin == "written"]
    assert written.source.startswith("K") and "Auxiliary seal-flush pump" in written.source
    assert run.case.critic_consulted and run.rounds == 3


def test_the_critic_is_given_a_case_once_and_only_when_something_is_unexplained():
    store, case_id, nothing_fits = _run("unlisted_impact")
    _, _, clear = _run(FaultKind.OUTER_RACE)

    assert store.get(case_id).critic_turns == 1
    assert [s.tool for s in nothing_fits.steps if s.agent == "critic"] == [
        "bearing_frequency_matches",
        "search_knowledge",
        "narrate",
    ]
    assert nothing_fits.case.status == "unresolved", "the critic found nothing, and said so"
    assert not [s for s in clear.steps if s.agent == "critic"], "a clear case needs no critic"
    assert not clear.case.critic_consulted


class _SuspectWriter(BaseLlm):
    """An investigator that tries to write a suspect, which is not its job."""

    model: str = "suspect-writer"
    case_id: str = ""

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        suspect = {
            "name": "made_up_cause",
            "description": "Something the model made up to win the case.",
            "tones": [{"order": 2.0, "relative_amplitude": 3.0}],
        }
        call = types.FunctionCall(
            name="propose_suspect", args={"case_id": self.case_id, "suspect": suspect}
        )
        yield LlmResponse(
            content=types.Content(role="model", parts=[types.Part(function_call=call)])
        )


def test_an_agent_that_reaches_for_a_tool_it_was_not_given_gets_nothing():
    # The split is not an instruction the model may ignore: the tool is not there.
    store = InMemoryCaseStore()
    case_id = open_case(store, BENCH_RIG, synthetic_capture(FaultKind.OUTER_RACE, BENCH_RIG)).id

    run = investigate(store, case_id, model=_SuspectWriter(case_id=case_id), max_model_calls=3)

    assert {s.tool for s in run.steps} == {"propose_suspect"}
    assert all("no tool with that name is available" in str(s.result) for s in run.steps)
    case = store.get(case_id)
    assert case.written_suspects == [] and case.investigation.written_suspects == ()
    assert "made_up_cause" not in {h.name for h in case.investigation.state.hypotheses}


def test_the_screen_is_told_which_agent_made_each_call():
    client = TestClient(app)
    run = client.post("/agent/replay", json={"fault": "aux_pump", "plant": "t-two-agents"}).json()

    who = {step["agent"] for step in run["steps"]}
    assert who == {"investigator", "critic"}
    looked = next(step for step in run["steps"] if step["tool"] == "search_knowledge")
    assert looked["agent"] == "critic"
    assert looked["asked"].startswith("Look in the machine's documents:")
    assert "Auxiliary seal-flush pump" in looked["answered"]
    wrote = next(step for step in run["steps"] if step["tool"] == "propose_suspect")
    assert "Taken from K" in wrote["asked"]
    assert run["case"]["status"] == "concluded"
