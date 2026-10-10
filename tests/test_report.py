"""The result of a case in words.

The engine states the verdict, the reason, the action and what would change it.
A model may add an explanation, and each of its sentences is kept only if the
evidence it cites backs it. No test here calls a model: the writers are fakes
that say exactly what the test needs said.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from hypothesis_engine.agents import factory, ollama, report
from hypothesis_engine.agents.report import (
    NO_VERDICT_ACTION,
    CarelessWriter,
    engine_lines,
    evidence_of,
    why_not,
    write_report,
)
from hypothesis_engine.api.app import app
from hypothesis_engine.data.rig import BENCH_RIG, rig_oracle, synthetic_capture
from hypothesis_engine.investigation.engine import Investigation
from hypothesis_engine.models import InvestigationState
from hypothesis_engine.ticket.draft import Sentence

client = TestClient(app)

_SETTINGS = (
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_GENAI_USE_VERTEXAI",
    "GOOGLE_GENAI_USE_ENTERPRISE",
    "OLLAMA_MODEL",
    "CRUX_REPORT_MODEL",
)


@pytest.fixture(autouse=True)
def no_model_configured(monkeypatch):
    for name in _SETTINGS:
        monkeypatch.delenv(name, raising=False)


def _closed(fault: str, severity: float = 1.0, extra_noise: float = 0.05) -> InvestigationState:
    capture = synthetic_capture(
        fault, BENCH_RIG, severity=severity, seed=1234, extra_noise=extra_noise
    )
    answers = rig_oracle(fault, BENCH_RIG, severity=severity, extra_noise=extra_noise)
    return Investigation(BENCH_RIG, capture).run(oracle=answers)


@pytest.fixture(scope="module")
def outer() -> InvestigationState:
    state = _closed("outer_race")
    assert state.conclusion is not None and state.conclusion.cause == "outer_race"
    return state


@pytest.fixture(scope="module")
def healthy() -> InvestigationState:
    state = _closed("healthy")
    assert state.conclusion is not None and state.conclusion.cause == "healthy"
    return state


@pytest.fixture(scope="module")
def unresolved() -> InvestigationState:
    # A fault that is not on the list, faint, on a noisy floor.
    state = _closed("rolling_element", severity=0.25, extra_noise=0.6)
    assert state.outcome == "unresolved"
    return state


class _Says:
    """A writer that says what it is told to, and counts how often it is asked."""

    name = "a model under test"

    def __init__(self, *sentences: tuple[str, list[str]]) -> None:
        self.sentences = [Sentence(text, tuple(cites)) for text, cites in sentences]
        self.asked = 0

    def write(self, evidence, state) -> list[Sentence]:
        self.asked += 1
        return self.sentences


class _Fails:
    name = "a model that is down"

    def write(self, evidence, state) -> list[Sentence]:
        raise TimeoutError("no answer in 30 s")


def _entry(state: InvestigationState, words: str):
    """The one ledger entry whose statement holds these words."""
    (found,) = [e for e in state.ledger if words in e.statement]
    return found


def _plain(written: report.Report) -> list[str]:
    return [line.text for line in written.lines if line.part == "plain"]


# ------------------------------------------------------------------ the engine's lines


def test_the_engine_states_the_verdict_the_reason_the_action_and_what_would_change_it(outer):
    written = write_report(outer, look_for_model=False)
    by_part = {line.part: line for line in written.lines}

    assert [line.part for line in written.lines] == ["verdict", "why", "action", "change"]
    assert {line.by for line in written.lines} == {"engine"}
    assert "outer race" in by_part["verdict"].text and "80%" in by_part["verdict"].text
    assert by_part["why"].cites == (_entry(outer, "simulated outer race").id,)
    assert "(E" not in by_part["why"].text, "the screen shows citations; the text does not"
    assert by_part["action"].text == outer.conclusion.recommended_action
    assert by_part["change"].text == outer.conclusion.what_would_change_my_mind
    assert written.explained_by == "" and "No language model is on" in written.notes[0]


def test_a_healthy_verdict_keeps_what_it_could_not_have_seen_as_its_own_line(healthy):
    limit = healthy.conclusion.limit
    assert "cannot be excluded" in limit, "this case has a fault the evidence cannot rule out"
    assert healthy.conclusion.reasoning.endswith(limit), "the reasoning still carries it too"

    written = write_report(healthy, look_for_model=False)
    parts = [line.part for line in written.lines]
    by_part = {line.part: line for line in written.lines}

    assert parts == ["verdict", "why", "limit", "action", "change"]
    assert by_part["limit"].text == limit
    assert "cannot be excluded" not in by_part["why"].text, "said once, not twice"
    assert "no fault found" in by_part["verdict"].text


def test_no_verdict_is_reported_as_no_verdict_and_is_not_given_to_a_model(unresolved):
    model = _Says(("The inner race is probably failing.", ["why"]))
    written = write_report(unresolved, model)
    by_part = {line.part: line for line in written.lines}

    assert model.asked == 0, "why there is no verdict is the engine's to say, word for word"
    assert [line.part for line in written.lines] == ["verdict", "why", "action"]
    assert by_part["verdict"].text.startswith("No cause is named")
    named = [h.label for h in unresolved.hypotheses if h.label in by_part["verdict"].text.lower()]
    assert named == [], "a line that says there is no cause names none"
    assert by_part["why"].text.lower() == unresolved.unresolved_reason.lower()
    assert by_part["action"].text == NO_VERDICT_ACTION
    assert "not asked" in written.notes[0]


def test_an_open_case_is_reported_as_open_and_no_model_is_asked():
    capture = synthetic_capture("inner_race", BENCH_RIG, severity=0.5, seed=555, extra_noise=0.45)
    inv = Investigation(BENCH_RIG, capture)
    inv.observe()
    inv.run_virtual_experiments()
    inv.advance()
    assert inv.state.outcome == "open", "this case waits for a reading"

    model = _Says(("Anything at all.", ["verdict"]))
    written = write_report(inv.state, model)

    assert model.asked == 0
    assert [line.part for line in written.lines] == ["verdict"]
    assert written.lines[0].text.startswith("The case is open")


# ------------------------------------------------------------------ the check


def test_a_figure_nobody_measured_is_removed_and_the_reason_is_given(outer):
    peak = _entry(outer, "envelope peak at BPFO")
    true = f"The envelope peak at BPFO stands {peak.value:.0f} times above the median."
    model = _Says((true, [peak.id]), ("The bearing has about 40 hours of life left.", [peak.id]))

    written = write_report(outer, model)

    assert _plain(written) == [true], "rounding a measured figure is fine"
    (gone,) = written.removed
    assert gone.text == "The bearing has about 40 hours of life left."
    assert gone.why == "40 is not in the evidence it cites"


def test_a_figure_counts_only_if_it_is_in_the_entry_the_sentence_cites(outer):
    speed = _entry(outer, "shaft speed, reported")
    peak = _entry(outer, "envelope peak at BPFO")
    said = f"The shaft turns at {speed.value} rpm."

    kept = write_report(outer, _Says((said, [speed.id])))
    removed = write_report(outer, _Says((said, [peak.id])))

    assert _plain(kept) == [said]
    assert _plain(removed) == [] and "is not in the evidence it cites" in removed.removed[0].why


def test_a_thousands_separator_does_not_split_a_number(outer):
    speed = _entry(outer, "shaft speed, reported")
    said = f"The shaft turns at {round(speed.value):,} rpm."
    assert "," in said, "the case runs fast enough for the figure to carry a separator"

    assert _plain(write_report(outer, _Says((said, [speed.id])))) == [said]


def test_a_cause_is_named_only_where_the_cited_evidence_names_it(outer):
    speed = _entry(outer, "shaft speed, reported")
    simulated = _entry(outer, "simulated inner race")
    model = _Says(
        ("The inner race is what failed.", [speed.id]),
        ("The inner-race simulation fitted the capture worse.", [simulated.id]),
        ("The outer race fitted best of all.", ["verdict"]),
    )

    written = write_report(outer, model)

    assert _plain(written) == [
        "The inner-race simulation fitted the capture worse.",
        "The outer race fitted best of all.",
    ]
    (gone,) = written.removed
    assert gone.why == "it names inner race, which the evidence it cites does not"


def test_a_measurement_does_not_license_naming_a_cause(outer):
    # An entry about the outer race's rate measures something. Naming the outer
    # race as the cause takes the engine's verdict, or that suspect's simulation.
    peak = _entry(outer, "envelope peak at BPFO")
    said = f"The outer race's rate stands {peak.value:.0f} times above the median."

    alone = write_report(outer, _Says((said, [peak.id])))
    with_verdict = write_report(outer, _Says((said, ["verdict", peak.id])))

    assert _plain(alone) == []
    assert alone.removed[0].why == "it names outer race, which the evidence it cites does not"
    assert _plain(with_verdict) == [said]
    # The abbreviation is explained to the reader, beside the entry and not in it.
    shown = {e["id"]: e["statement"] for e in alone.to_dict()["evidence"]}
    assert "BPFO: the rate a defect on the outer race would strike at" in shown[peak.id]
    assert "outer race" not in peak.statement


def test_a_sentence_must_cite_evidence_that_exists(outer):
    model = _Says(("A technician confirmed it by eye.", ["E99"]), ("It is certain.", []))

    written = write_report(outer, model)

    assert _plain(written) == []
    assert [r.why for r in written.removed] == [
        "it cites E99, which is not in the evidence",
        "it cites no evidence",
    ]


def test_a_sentence_may_not_rest_on_every_entry_at_once(outer):
    ids = [e.id for e in outer.ledger][:5]
    written = write_report(outer, _Says(("All of this points one way.", ids)))

    assert _plain(written) == []
    assert written.removed[0].why == "it cites 5 entries; a sentence may rest on at most 3"


def test_the_action_is_not_a_models_to_restate_nor_a_limit_its_to_set(outer):
    crest = _entry(outer, "crest factor")
    model = _Says(
        ("Replace the bearing today.", ["action"]),
        ("The crest factor is within acceptable limits.", [crest.id]),
    )

    written = write_report(outer, model)

    assert _plain(written) == []
    assert written.removed[0].why == "it cites action, which is not in the evidence"
    assert written.removed[1].why.startswith('it calls a reading "acceptable"')
    assert "action" not in {e.id for e in written.evidence}
    assert "change" not in {e.id for e in written.evidence}


def test_whatever_a_model_writes_the_engines_lines_stand_as_they_were(outer):
    peak = _entry(outer, "envelope peak at BPFO")
    model = _Says(
        ("Verdict: misalignment, at 99% belief.", ["verdict"]),
        ("The impacts repeat at the outer race's own rate.", ["verdict", peak.id]),
        ("Keep running; nothing needs doing.", [peak.id]),
    )

    written = write_report(outer, model)

    assert [line for line in written.lines if line.by == "engine"] == engine_lines(outer)
    assert [line.part for line in written.lines] == [
        "verdict",
        "why",
        "plain",
        "plain",
        "action",
        "change",
    ]
    assert written.removed[0].text.startswith("Verdict: misalignment")
    # The check holds numbers and names. It cannot tell that the last sentence
    # gives an instruction, which is why the engine's action is printed beside it.
    assert "Keep running; nothing needs doing." in _plain(written)
    assert written.explained_by == "a model under test"


def test_a_model_that_fails_leaves_the_engines_report_and_says_why(outer, monkeypatch):
    monkeypatch.setattr(factory, "_FAILURES", {})

    written = write_report(outer, _Fails())

    assert written.lines == engine_lines(outer)
    assert written.explained_by == "" and written.removed == []
    assert "could not write an explanation (TimeoutError)" in written.notes[0]
    assert "no answer in 30 s" in factory.describe()["report_writer_not_live"]


def test_a_model_whose_every_sentence_fails_is_reported_as_such(outer):
    written = write_report(outer, _Says(("It has 12 days left.", ["verdict"])))

    assert written.lines == engine_lines(outer)
    assert "wrote 1 sentence, and the evidence cited backed none" in written.notes[0]


def test_writing_a_report_changes_nothing_in_the_case(outer):
    before = (
        dict(outer.beliefs()),
        [e.render() for e in outer.ledger],
        outer.outcome,
        outer.conclusion,
        list(outer.transcript),
    )

    write_report(outer, CarelessWriter())

    assert before == (
        dict(outer.beliefs()),
        [e.render() for e in outer.ledger],
        outer.outcome,
        outer.conclusion,
        list(outer.transcript),
    )


def test_the_careless_writer_loses_each_false_claim_for_its_own_reason(outer):
    written = write_report(outer, CarelessWriter())

    assert len(_plain(written)) == 1, "its one true sentence is kept"
    reasons = sorted(r.why for r in written.removed)
    assert len(reasons) == 3
    assert reasons[0].endswith("is not in the evidence it cites")
    assert reasons[1] == "it cites E99, which is not in the evidence"
    assert reasons[2].startswith("it names ") and "healthy" not in reasons[2]


# ------------------------------------------------------------------ the writers


def test_a_reply_in_the_wrong_shape_is_a_failure_not_a_report(outer):
    with pytest.raises((KeyError, TypeError, ValueError)):
        report._parsed("[]")
    with pytest.raises(ValueError):
        report._parsed('{"sentences": [{"text": "cut off mid')

    (uncited,) = report._parsed('{"sentences": [{"text": "It is certain."}]}')
    assert why_not(uncited, evidence_of(outer), outer) == "it cites no evidence"


def test_a_local_model_is_bounded_and_its_reply_goes_through_the_same_check(outer, monkeypatch):
    peak = _entry(outer, "envelope peak at BPFO")
    asked: dict = {}

    def chat(prompt, **options):
        asked.update(options, prompt=prompt)
        return json.dumps(
            {
                "sentences": [
                    {"text": f"The peak reads {peak.value} ({peak.id}).", "cites": [peak.id]},
                    {"text": "It will fail in 3 days.", "cites": [peak.id]},
                ]
            }
        )

    monkeypatch.setenv("OLLAMA_MODEL", "a-local-model")
    monkeypatch.setattr(ollama, "available", lambda *a, **k: True)
    monkeypatch.setattr(ollama, "chat", chat)

    written = write_report(outer)

    assert written.explained_by == "ollama:a-local-model"
    assert _plain(written) == [f"The peak reads {peak.value}."], "the inline citation is dropped"
    assert written.removed[0].why == "3 is not in the evidence it cites"
    assert asked["max_tokens"] == report.MAX_TOKENS and asked["timeout_s"] == report.TIMEOUT_S
    assert f"{peak.id} (sensor): envelope peak at BPFO" in asked["prompt"]
    assert outer.conclusion.recommended_action not in asked["prompt"], "the action is not shown"


def test_the_explanation_can_be_switched_off(outer, monkeypatch):
    monkeypatch.setenv("OLLAMA_MODEL", "a-local-model")
    monkeypatch.setattr(ollama, "available", lambda *a, **k: True)
    monkeypatch.setattr(ollama, "chat", lambda *a, **k: pytest.fail("the model was called"))
    monkeypatch.setenv("CRUX_REPORT_MODEL", "off")

    written = write_report(outer)

    assert written.lines == engine_lines(outer)
    assert factory.describe()["report_writer"] == "off (CRUX_REPORT_MODEL=off)"


# ------------------------------------------------------------------ the API


def test_a_closed_case_has_a_report_and_the_check_can_be_seen_working():
    case = client.post("/replay", json={"fault": "outer_race", "seed": 1234}).json()
    assert case["outcome"] == "concluded"

    own = client.get(f"/investigations/{case['id']}/report", params={"writer": "engine"}).json()
    assert [line["part"] for line in own["lines"]] == ["verdict", "why", "action", "change"]
    assert own["removed"] == [] and own["explained_by"] == ""
    assert {e["id"] for e in own["evidence"]} >= {e["id"] for e in case["ledger"]}

    shown = client.get(f"/investigations/{case['id']}/report", params={"writer": "careless"})
    assert shown.status_code == 200
    assert len(shown.json()["removed"]) == 3
    assert shown.json()["explained_by"] == CarelessWriter.name
    # Asking for a report moved nothing.
    assert client.get(f"/investigations/{case['id']}").json()["hypotheses"] == case["hypotheses"]


def test_the_report_route_refuses_what_it_does_not_know():
    case = client.post("/replay", json={"fault": "healthy", "seed": 7}).json()

    assert client.get("/investigations/no-such-case/report").status_code == 404
    bad = client.get(f"/investigations/{case['id']}/report", params={"writer": "gemini"})
    assert bad.status_code == 400


def test_a_case_the_investigator_worked_has_a_report_too():
    pytest.importorskip("google.adk")
    run = client.post("/agent/replay", json={"fault": "outer_race", "seed": 1234}).json()
    assert run["case"]["status"] == "concluded"

    written = client.get(
        f"/investigations/{run['case']['case_id']}/report", params={"writer": "engine"}
    )

    assert written.status_code == 200
    assert "outer race" in written.json()["lines"][0]["text"]
