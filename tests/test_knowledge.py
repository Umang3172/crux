"""What is written down about a machine, and the one way it reaches a diagnosis.

A passage is knowledge, never evidence. A model may write a suspect from one;
the suspect is then held to the passage it cites and tested by the physics like
any other. The document here is a demo document built from the rig's own
description of the machine, and says so.
"""

from __future__ import annotations

import pytest

from hypothesis_engine.data.cwru import CWRU_DRIVE_END
from hypothesis_engine.data.rig import (
    AUX_PUMP_LOBES,
    AUX_PUMP_ORDER,
    AUX_PUMP_RATIO,
    BENCH_RIG,
    synthetic_capture,
)
from hypothesis_engine.knowledge import TOP, KnowledgeBase, for_machine
from hypothesis_engine.knowledge.documents import DEMO_NOTE, Document
from hypothesis_engine.models import FaultKind
from hypothesis_engine.physics.frequencies import kinematic_matches, shaft_hz
from hypothesis_engine.physics.likelihood import LINE_TOLERANCE, accounts_for, explained_lines
from hypothesis_engine.physics.signatures import predicted_signature
from hypothesis_engine.tools import MAX_TEXT_CHARS, InMemoryCaseStore, InvestigatorTools, open_case
from hypothesis_engine.tools.contract import SuspectSpec

ON_FILE = for_machine(BENCH_RIG.machine_id)


def _case(fault: FaultKind | str = "aux_pump", machine=BENCH_RIG):
    store = InMemoryCaseStore()
    case = open_case(store, machine, synthetic_capture(fault, machine))
    tools = InvestigatorTools(store)
    tools.run_virtual_experiments(case.id)
    return store, tools, case.id


def _suspect(passage_id: str, **changes) -> SuspectSpec:
    spec = {
        "name": "auxiliary_seal_flush_pump",
        "description": f"The seal-flush booster pump has {AUX_PUMP_LOBES} lobes on a belt at "
        f"{AUX_PUMP_RATIO:g} to 1, so a worn lobe knocks {AUX_PUMP_ORDER:g} times per turn.",
        "impacts": [{"rate_order": AUX_PUMP_ORDER, "relative_amplitude": 4.0}],
        "cites": [passage_id],
    }
    return SuspectSpec(**{**spec, **changes})


def _aux_passage():
    (found,) = [p for p in ON_FILE.passages if p.section == "Auxiliary seal-flush pump"]
    return found


# ------------------------------------------------------------------ the documents


def test_the_notes_on_file_describe_the_rig_they_are_built_from():
    text = " ".join(p.text for p in ON_FILE.passages)
    bearing = BENCH_RIG.bearing

    assert f"{BENCH_RIG.nominal_rpm:g} rpm" in text
    assert f"{bearing.n_rolling_elements} balls" in text
    assert f"{BENCH_RIG.blade_count} vanes" in text
    assert f"{AUX_PUMP_ORDER:g} times for every turn of the main shaft" in _aux_passage().text
    assert pytest.approx(AUX_PUMP_ORDER) == AUX_PUMP_RATIO * AUX_PUMP_LOBES
    assert {p.note for p in ON_FILE.passages} == {DEMO_NOTE}, "every passage says what it is"
    assert [p.id for p in ON_FILE.passages] == [f"K{i + 1}" for i in range(len(ON_FILE.passages))]


@pytest.mark.parametrize(
    ("question", "section"),
    [
        ("how many balls does the drive-end bearing have", "Drive-end bearing"),
        (
            "what else is driven from the main shaft and how often does it strike",
            "Auxiliary seal-flush pump",
        ),
        ("debris caught between the vanes", "Impeller"),
        ("when should the alignment be checked", "Coupling and alignment"),
    ],
)
def test_a_question_brings_back_the_passage_that_answers_it(question, section):
    found = ON_FILE.search(question)

    assert found[0].section == section
    assert len(found) <= TOP


def test_a_question_nothing_on_file_answers_brings_back_nothing():
    assert ON_FILE.search("zebra crossing") == []
    assert KnowledgeBase().search("anything at all") == []


def test_a_document_is_cut_at_its_headings():
    doc = Document("Notes", "\n## One\nfirst part\nstill the first\n\n## Two\nsecond part\n")

    assert doc.sections() == [("One", "first part still the first"), ("Two", "second part")]


# ------------------------------------------------------------------ the tool


def test_a_model_can_look_in_the_documents_and_nothing_moves():
    _, tools, case_id = _case()
    before = tools.get_case(case_id)

    found = tools.search_knowledge(case_id, "another part driven from the main shaft")

    assert found.passages[0].section == "Auxiliary seal-flush pump"
    assert found.passages[0].note == DEMO_NOTE
    assert (
        found.detail == f"{len(found.passages)} of {len(ON_FILE.passages)} passages on file match."
    )
    after = tools.get_case(case_id)
    assert after.suspects == before.suspects and after.evidence == before.evidence


def test_a_machine_with_nothing_on_file_says_so():
    _, tools, case_id = _case(FaultKind.OUTER_RACE, machine=CWRU_DRIVE_END)

    found = tools.search_knowledge(case_id, "what else turns with the shaft")

    assert found.passages == [] and found.detail == "No document is on file for this machine."
    assert tools.search_knowledge(case_id, "x" * (MAX_TEXT_CHARS + 1)).passages == []


# ------------------------------------------------------------------ a suspect from a passage


def test_the_rate_in_the_notes_is_one_nothing_on_the_list_explains():
    # The premise of the scenario: the bearing table cannot explain this rate,
    # and neither can any hypothesis on the list.
    fr = shaft_hz(BENCH_RIG.nominal_rpm)
    lines = set()
    for kind in FaultKind:
        lines |= explained_lines(predicted_signature(kind, BENCH_RIG, BENCH_RIG.nominal_rpm), fr)

    assert not accounts_for(AUX_PUMP_ORDER, lines)
    assert kinematic_matches(AUX_PUMP_ORDER, BENCH_RIG.bearing, LINE_TOLERANCE) == []
    _, tools, case_id = _case()
    report = tools.bearing_frequency_matches(case_id)
    assert report.unexplained.order == pytest.approx(AUX_PUMP_ORDER, rel=0.01)
    assert report.matches == [], "no part of the bearing strikes at that rate"


def test_the_part_the_notes_name_is_written_as_a_suspect_and_the_physics_confirms_it():
    store, tools, case_id = _case()
    assert tools.get_case(case_id).blockers, "the premise: something stands in the way"
    passage = _aux_passage()

    review = tools.propose_suspect(case_id, _suspect(passage.id))
    view = tools.get_case(case_id)

    assert review.status == "tested", review.reasons
    assert view.leader == "auxiliary_seal_flush_pump" and view.blockers == []
    (written,) = [s for s in view.suspects if s.origin == "written"]
    assert written.source == f'{passage.id}: {passage.document}, "{passage.section}"'
    assert any("was written from" in line for line in view.transcript)
    assert tools.conclude(case_id).ok
    # It won on the evidence: the same suspect on a healthy capture goes nowhere.
    _, other, healthy = _case(FaultKind.HEALTHY)
    other.propose_suspect(healthy, _suspect(passage.id))
    assert other.get_case(healthy).leader == "healthy"


def test_a_suspect_is_held_to_the_passage_it_cites():
    passage = _aux_passage()
    wrong = {
        "a figure the passage does not hold": _suspect(
            passage.id, description="A booster pump with 4 lobes knocks 5.7 times per turn."
        ),
        "a rate the passage does not state": _suspect(
            passage.id,
            description="The seal-flush booster pump knocks on the bearing bracket.",
            impacts=[{"rate_order": 6.1, "relative_amplitude": 4.0}],
        ),
        "a passage that is not on file": _suspect("K99"),
        "the wrong passage": _suspect(ON_FILE.passages[1].id),
    }
    expected = {
        "a figure the passage does not hold": "4 is not in the evidence it cites",
        "a rate the passage does not state": "Its rate of 6.1 per shaft turn is not stated",
        "a passage that is not on file": "K99, which is not a passage on file",
        "the wrong passage": "is not in the evidence it cites",
    }

    for what, suspect in wrong.items():
        store, tools, case_id = _case()
        review = tools.propose_suspect(case_id, suspect)
        assert review.status == "refused", what
        assert expected[what] in review.reasons[0], (what, review.reasons)
        assert store.get(case_id).investigation.written_suspects == (), "the physics never saw it"


def test_a_rate_worked_out_from_two_figures_is_refused():
    # The passage states the ratio and the lobes. A rate has to be stated too:
    # one a model multiplied out is not taken on trust. A limit, on purpose.
    passage = _aux_passage()
    doubled = round(2 * AUX_PUMP_ORDER, 3)

    _, tools, case_id = _case()
    review = tools.propose_suspect(
        case_id,
        _suspect(
            passage.id,
            description="The seal-flush booster pump knocks twice as often as its lobes pass.",
            impacts=[{"rate_order": doubled, "relative_amplitude": 4.0}],
        ),
    )

    assert review.status == "refused"
    assert f"Its rate of {doubled:g} per shaft turn is not stated" in review.reasons[0]
