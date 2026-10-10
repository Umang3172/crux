"""An investigator run in plain words: every figure comes from a tool result."""

from __future__ import annotations

from hypothesis_engine.agents.trace import describe


def test_narration_is_the_models_own_words_and_nothing_else():
    line = describe(
        "narrate", {"case_id": "inv_1", "text": "The bearing is the story."}, {"ok": True}
    )
    assert (line.kind, line.asked, line.answered) == ("says", "The bearing is the story.", None)


def test_a_refused_suspect_is_told_as_refused_with_the_reason():
    args = {
        "suspect": {
            "name": "bent_shaft",
            "description": "A bow in the shaft.",
            "tones": [{"order": 1.0, "relative_amplitude": 4.0}],
        }
    }
    result = {"name": "bent_shaft", "status": "refused", "reasons": ["It predicts nothing new."]}
    line = describe("propose_suspect", args, result)
    assert "bent shaft" in line.asked and "a tone at 1x shaft speed" in line.asked
    assert line.answered == "Refused. It predicts nothing new."


def test_a_verdict_that_is_not_yet_supported_says_why():
    line = describe("conclude", {}, {"ok": False, "detail": "healthy leads at 60%."})
    assert line.answered == "Not yet. healthy leads at 60%."


def test_a_reading_is_quoted_from_the_tool_never_made_up():
    answered = {
        "ok": True,
        "detail": "answered",
        "request": {"test_name": "Envelope capture", "status": "answered", "reading": -0.5523},
    }
    line = describe("request_measurement", {"test_id": "envelope"}, answered)
    assert line.asked == "Request the measurement: Envelope capture."
    assert line.answered == "The reading came back: -0.552."
    waiting = {
        "ok": True,
        "detail": "waiting",
        "request": {"test_name": "Envelope capture", "status": "waiting"},
    }
    assert describe("request_measurement", {"test_id": "envelope"}, waiting).answered == (
        "Waiting for the reading."
    )


def test_a_call_with_no_answer_yet_and_an_unknown_tool_are_still_shown():
    assert describe("conclude", {}, None).answered is None
    line = describe("some_new_tool", {}, {"detail": "done"})
    assert line.asked == "Call some_new_tool." and line.answered == "done"
