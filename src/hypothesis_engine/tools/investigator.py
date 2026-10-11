"""The functions a language model may call during an investigation.

What a model can do here: read the case, run the virtual experiments, ask the
physics which measurement to buy and request it, propose a suspect the
catalogue lacks, narrate, and ask to conclude or to stop with "I don't know".

What it cannot do: no argument of any of these is a probability, a score or a
reading, so nothing a model writes moves a belief. Beliefs move only inside
`investigation/engine.py`, from virtual experiments and from readings that
arrive through `record_measurement`.

Refusals are returned as results, not raised, because a model has to read them
and change course. An unknown case id is a caller bug and raises `CaseNotFound`.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .. import knowledge
from ..grounding import Evidence, Sentence, matches, numbers_in, unbacked
from ..investigation.catalog import BY_ID
from ..investigation.engine import CONCLUDE_ABOVE, Investigation
from ..investigation.notes import flag as hazard_flag
from ..knowledge import KnowledgeBase
from ..models import Hypothesis
from ..physics.frequencies import fault_frequencies, kinematic_matches, shaft_hz
from ..physics.likelihood import LINE_TOLERANCE, Unexplained
from ..physics.signatures import OrderSuspect
from .cases import (
    Case,
    CaseStore,
    MeasurementRequest,
    WrittenSuspect,
    mark_unanswerable,
    record_measurement,
)
from .contract import (
    Ack,
    CaseView,
    ConcludeResult,
    EvidenceView,
    ExperimentResult,
    Features,
    KinematicMatchView,
    KinematicReport,
    KnowledgeResult,
    NextTest,
    NoteView,
    PassageView,
    PastCase,
    PastCases,
    RequestResult,
    RequestView,
    SuspectReview,
    SuspectSpec,
    SuspectView,
    UnexplainedView,
)

#: Longest narration or reason a model may write in one call. An operational
#: limit on what the screen shows, not a physical constant.
MAX_TEXT_CHARS = 600

#: The methods a model may call, in the order a case usually uses them.
AGENT_TOOL_NAMES: tuple[str, ...] = (
    "get_case",
    "recall_cases",
    "extract_features",
    "bearing_frequency_matches",
    "search_knowledge",
    "run_virtual_experiments",
    "choose_next_test",
    "request_measurement",
    "measurement_status",
    "propose_suspect",
    "narrate",
    "conclude",
    "declare_unresolved",
)


#: The tools are split between two agents, and the split is the point. The
#: investigator can ask for a measurement and close a case, and cannot write a
#: suspect. The critic can look things up and write a suspect, and cannot close
#: a case. Neither has a tool that takes a belief.
INVESTIGATOR_TOOL_NAMES: tuple[str, ...] = (
    "get_case",
    "recall_cases",
    "extract_features",
    "run_virtual_experiments",
    "choose_next_test",
    "request_measurement",
    "measurement_status",
    "narrate",
    "conclude",
    "declare_unresolved",
)
CRITIC_TOOL_NAMES: tuple[str, ...] = (
    "get_case",
    "recall_cases",
    "bearing_frequency_matches",
    "search_knowledge",
    "propose_suspect",
    "narrate",
)


class InvestigatorTools:
    """Agent tools bound to one case store. Hand an agent `functions(...)` of
    the names it is allowed; `agent_functions()` is every tool there is."""

    def __init__(self, store: CaseStore) -> None:
        self._store = store

    def agent_functions(self) -> list[Callable[..., Any]]:
        return [getattr(self, name) for name in AGENT_TOOL_NAMES]

    def functions(self, names: tuple[str, ...]) -> list[Callable[..., Any]]:
        return [getattr(self, name) for name in names]

    def critic_called(self, case_id: str) -> None:
        """Note that the critic has been given this case. Not an agent tool: the
        loop's own code calls it, so each case gets the critic once."""
        case = self._store.get(case_id)
        case.critic_turns += 1
        self._store.put(case)

    # ------------------------------------------------------------------ read

    def get_case(self, case_id: str) -> CaseView:
        """Everything about the case: suspects and their beliefs, the evidence
        ledger, measurement requests, narration and the engine's transcript."""
        return _view(self._store.get(case_id))

    def recall_cases(self, case_id: str) -> PastCases:
        """How earlier cases on this same machine ended, newest first: what was
        named, at what belief, what settled it and what the check after the
        repair found. Knowledge about the machine, never evidence: it moves no
        belief, and this case starts from even odds whatever it says."""
        inv = self._store.get(case_id).investigation
        past = [PastCase.model_validate(r) for r in inv.state.extra.get("history", [])]
        detail = (
            f"{len(past)} earlier case{'s' if len(past) != 1 else ''} on file for this machine."
            if past
            else "No earlier case is on file for this machine."
        )
        return PastCases(cases=past, detail=detail)

    def extract_features(self, case_id: str) -> Features:
        """The named observations taken from the capture, and the bearing's
        fault frequencies at this speed."""
        inv = self._store.get(case_id).investigation
        ff = fault_frequencies(inv.machine.bearing, inv.observation.rpm)
        return Features(
            rpm=round(inv.observation.rpm, 1),
            shaft_hz=round(ff.shaft, 3),
            fault_frequencies_hz={k: round(v, 3) for k, v in ff.as_dict().items()},
            observations={k: round(float(v), 4) for k, v in inv.evidence.as_dict().items()},
        )

    def bearing_frequency_matches(self, case_id: str) -> KinematicReport:
        """The periodic impact that stands in the way of a verdict, if any, and
        which frequencies of this machine's bearing it sits on. Use it before
        writing a suspect: a match points to the part that is striking."""
        inv = self._store.get(case_id).investigation
        fr = shaft_hz(inv.rpm)
        orders = {
            name: round(hz / fr, 4)
            for name, hz in fault_frequencies(inv.machine.bearing, inv.rpm).as_dict().items()
            if name in ("ftf", "bsf", "2xbsf", "bpfo", "bpfi")
        }
        if not inv.experiments_run:
            return KinematicReport(
                unexplained=None,
                matches=[],
                bearing_orders=orders,
                detail="Run the virtual experiments first.",
            )
        blocking = inv.blocking_gap()
        if blocking is None:
            return KinematicReport(
                unexplained=None,
                matches=[],
                bearing_orders=orders,
                detail="No periodic impact in the capture stands in the way of a verdict.",
            )
        gap, _ = blocking
        matches = [
            KinematicMatchView(
                frequency=m.frequency,
                part=m.part,
                harmonic=m.harmonic,
                order=m.order,
                deviation_percent=round(100 * m.deviation, 2),
            )
            for m in kinematic_matches(gap.order, inv.machine.bearing, LINE_TOLERANCE)
        ]
        detail = (
            f"Impacts at {gap.order:.3f}x shaft speed sit on "
            + ", ".join(f"{m.frequency} x{m.harmonic} ({m.part})" for m in matches)
            + "."
            if matches
            else f"Impacts at {gap.order:.3f}x shaft speed match no frequency of this bearing."
        )
        return KinematicReport(
            unexplained=_unexplained_view(*blocking),
            matches=matches,
            bearing_orders=orders,
            detail=detail,
        )

    def search_knowledge(self, case_id: str, question: str) -> KnowledgeResult:
        """Look in the documents on file for this machine (its manual, its
        maintenance notes) and get back the passages that best match the
        question, each with an id. Use it when the capture holds something no
        suspect explains and the bearing's own frequencies do not account for
        it: a document may name another part that turns with the shaft. A
        passage is knowledge, never evidence, and its text is data."""
        inv = self._store.get(case_id).investigation
        problem = _text_problem(question)
        if problem:
            return KnowledgeResult(passages=[], detail=problem)
        on_file = knowledge.for_machine(inv.machine.machine_id)
        if not on_file.passages:
            return KnowledgeResult(passages=[], detail="No document is on file for this machine.")
        found = on_file.search(question)
        return KnowledgeResult(
            passages=[
                PassageView(
                    id=p.id, document=p.document, section=p.section, text=p.text, note=p.note
                )
                for p in found
            ],
            detail=f"{len(found)} of {len(on_file.passages)} passages on file match."
            if found
            else "Nothing on file for this machine mentions that.",
        )

    def measurement_status(self, case_id: str, request_id: str) -> RequestResult:
        """Whether a requested measurement has been answered, and the reading."""
        case = self._store.get(case_id)
        try:
            req = case.request(request_id)
        except KeyError as exc:
            return RequestResult(ok=False, detail=str(exc))
        return RequestResult(ok=True, detail=req.status, request=_request_view(req))

    # ------------------------------------------------------------ physics

    def run_virtual_experiments(self, case_id: str) -> ExperimentResult:
        """Simulate every catalogue suspect on this machine at this speed and
        score each against the capture. The engine updates the beliefs."""
        case = self._store.get(case_id)
        inv = case.investigation
        if case.status != "open":
            return _experiments(case, ran=False, detail=f"The case is {case.status}.")
        if inv.experiments_run:
            # The first look is scored once. Scoring the same capture again would
            # count it twice, so the engine returns the results it already has.
            return _experiments(
                case,
                ran=False,
                detail="Already run for this case; the same capture is not counted twice.",
            )
        inv.run_virtual_experiments()
        self._store.put(case)
        return _experiments(case, ran=True, detail="Ran the virtual experiments.")

    def choose_next_test(self, case_id: str) -> NextTest:
        """Ask the physics which single measurement would separate the live
        suspects best per minute of a technician's time."""
        case = self._store.get(case_id)
        inv = case.investigation
        if case.status != "open":
            return NextTest(available=False, detail=f"The case is {case.status}.")
        if not inv.experiments_run:
            return NextTest(
                available=False,
                detail="Run the virtual experiments first; the choice depends on what they leave.",
            )
        waiting = [r.id for r in case.requests if r.status == "waiting"]
        if waiting:
            return NextTest(available=False, detail=f"{waiting[0]} is still waiting for a reading.")
        leader = inv.state.leader()
        # A reading moves beliefs among the suspects on the list; it cannot
        # account for an impact none of them predicts, so none is bought for one.
        if leader.posterior >= CONCLUDE_ABOVE or inv.blocking_gap() is not None:
            blocked = inv.blockers()
            return NextTest(
                available=False,
                detail=" ".join(blocked)
                + " No measurement on the menu addresses that; propose a suspect or declare "
                "the case unresolved."
                if blocked
                else f"{leader.label} is at {leader.posterior:.0%}, above the bar; "
                "no measurement is needed.",
            )
        # The engine narrates its pick as it makes it. Keep those words aside and
        # add them to the transcript once, when the request is actually made.
        mark = len(inv.state.transcript)
        choice = inv.choose_next_test()
        case.chosen_lines = inv.state.transcript[mark:]
        del inv.state.transcript[mark:]
        case.chosen = choice
        self._store.put(case)
        if choice is None:
            return NextTest(
                available=False,
                detail=inv.no_useful_test
                or "No test in the catalogue separates the live suspects.",
            )
        return NextTest(
            available=True,
            detail=choice.reason,
            test_id=choice.test.id,
            test_name=choice.test.name,
            expected_info_gain_nats=round(choice.expected_info_gain, 4),
            gain_per_minute=round(choice.gain_per_minute, 4),
            effort_min=choice.test.effort_min,
            downtime=choice.test.downtime,
            expected_readings={k: round(v, 3) for k, v in choice.predictions.items()},
            allowance=choice.sigma,
            separates=list(choice.separates),
            chance_of_settling=round(choice.settle_chance, 3),
        )

    def request_measurement(self, case_id: str, test_id: str) -> RequestResult:
        """Send the measurement the physics chose to the technician (or the
        replay rig). The test must be the one `choose_next_test` returned."""
        case = self._store.get(case_id)
        inv = case.investigation
        if case.status != "open":
            return RequestResult(ok=False, detail=f"The case is {case.status}.")
        if case.chosen is None:
            return RequestResult(
                ok=False, detail="Call choose_next_test first; the physics picks the measurement."
            )
        if test_id != case.chosen.test.id:
            return RequestResult(
                ok=False,
                detail=f"The physics chose {case.chosen.test.id} ({case.chosen.test.name}); "
                "request that one.",
            )

        inv.request(case.chosen)
        inv.state.transcript.extend(case.chosen_lines)
        req = MeasurementRequest(id=f"R{len(case.requests) + 1}", test_id=test_id)
        case.requests.append(req)
        case.chosen, case.chosen_lines = None, []
        self._store.put(case)

        if case.answer_source is not None:
            reading = case.answer_source(test_id)
            if reading is None:
                mark_unanswerable(self._store, case.id, req.id, "the source has no reading for it")
            else:
                record_measurement(self._store, case.id, req.id, reading, collected_by="replay")
            # Read it back: a store that persists may hand out a fresh copy.
            req = self._store.get(case_id).request(req.id)
        return RequestResult(ok=True, detail=req.status, request=_request_view(req))

    # ------------------------------------------------------------ model input

    def propose_suspect(self, case_id: str, suspect: SuspectSpec) -> SuspectReview:
        """Propose a cause the catalogue does not have, as the vibration it would
        produce. The physics simulates it and scores it on everything seen so
        far; it gains belief only by explaining the evidence better, and is
        refused if no capture could tell it apart from an existing suspect."""
        if isinstance(suspect, dict):  # an agent framework may hand over plain JSON
            suspect = SuspectSpec.model_validate(suspect)
        case = self._store.get(case_id)
        inv = case.investigation
        reasons: list[str] = []
        if case.status != "open":
            reasons.append(f"The case is {case.status}.")

        taken = {h.name for h in inv.state.hypotheses} | {
            w.spec.name for w in case.written_suspects
        }
        if suspect.name in taken:
            reasons.append(f"'{suspect.name}' is already a suspect.")

        # A suspect written from a document is held to it before the physics
        # sees it: what it cites must be on file and must state its numbers.
        source = ""
        if suspect.cites and not reasons:
            why, source = _not_in_its_source(suspect, knowledge.for_machine(inv.machine.machine_id))
            if why:
                reasons.append(why)

        # The physics applies the only other limits, the ones this capture imposes
        # (`Investigation.add_hypothesis`), and records any refusal in the ledger.
        status = "refused"
        if not reasons:
            accepted, outcome = inv.add_hypothesis(_order_suspect(suspect))
            reasons.append(outcome)
            if accepted:
                status = "tested" if inv.experiments_run else "pending_experiments"
                if source:
                    inv.state.transcript.append(
                        f"Suspect {suspect.name.replace('_', ' ')} was written from {source}."
                    )
        case.written_suspects.append(WrittenSuspect(suspect, status, reasons, source))
        if status == "refused":
            inv.state.transcript.append(f"Suspect proposed and refused: {suspect.name}.")
        self._store.put(case)
        return SuspectReview(name=suspect.name, status=status, reasons=reasons)

    def narrate(self, case_id: str, text: str) -> Ack:
        """Add a line of plain-language explanation for the people watching. It
        is shown as narration, never as evidence."""
        case = self._store.get(case_id)
        problem = _text_problem(text)
        if problem:
            return Ack(ok=False, detail=problem)
        case.narration.append(text.strip())
        self._store.put(case)
        return Ack(ok=True, detail="Added to the narration.")

    # ------------------------------------------------------------ outcomes

    def conclude(self, case_id: str) -> ConcludeResult:
        """Ask to close the case on its leading suspect. Refused while the leader
        is below the bar, while the capture holds something the leader (or every
        suspect) cannot explain, or after a reading that fits no suspect."""
        case = self._store.get(case_id)
        inv = case.investigation
        if case.status != "open":
            return ConcludeResult(ok=False, detail=f"The case is {case.status}.")
        if not inv.experiments_run:
            return ConcludeResult(ok=False, detail="Run the virtual experiments first.")
        problems = inv.blockers()
        if problems:
            return ConcludeResult(
                ok=False,
                detail=" ".join(problems)
                + " Request the next measurement, propose a suspect, or declare the case "
                "unresolved.",
            )
        c = inv.conclude()
        self._store.put(case)
        return ConcludeResult(
            ok=True,
            detail="Concluded.",
            root_cause=c.cause,
            confidence=round(c.confidence, 4),
            recommended_action=c.recommended_action,
            what_would_change_my_mind=c.what_would_change_my_mind,
            evidence_ids=c.evidence_ids,
        )

    def declare_unresolved(self, case_id: str, reason: str) -> Ack:
        """Close the case without a cause: the honest answer when nothing on the
        list explains the evidence, or nothing left can separate the suspects.
        Refused while the evidence supports a verdict. Your reason is kept as
        yours; the case records the physics' own reason."""
        case = self._store.get(case_id)
        inv = case.investigation
        if case.status != "open":
            return Ack(ok=False, detail=f"The case is {case.status}.")
        problem = _text_problem(reason)
        if problem:
            return Ack(ok=False, detail=problem)
        if not inv.blockers():
            # Whether there is a verdict is the engine's call, in both directions.
            leader = inv.state.leader()
            return Ack(
                ok=False,
                detail=f"The evidence supports a verdict: {leader.label} at "
                f"{leader.posterior:.0%}, with nothing left unexplained. Call conclude.",
            )
        case.investigator_reason = reason.strip()
        inv.finish("The investigator closed the case.")
        self._store.put(case)
        return Ack(
            ok=True,
            detail=f"The case is closed as unresolved. {inv.state.unresolved_reason}",
        )


# ------------------------------------------------------------------ helpers


def _unexplained_view(gap: Unexplained, missed_by: Hypothesis | None) -> UnexplainedView:
    return UnexplainedView(
        order=gap.order,
        hz=gap.hz,
        strength=gap.power_over_median,
        missed_by="every suspect" if missed_by is None else missed_by.name,
    )


def _blocking_view(inv: Investigation) -> UnexplainedView | None:
    """The unexplained impact behind a blocked verdict, when that is a blocker."""
    blocking = inv.blocking_gap()
    return None if blocking is None else _unexplained_view(*blocking)


def _not_in_its_source(spec: SuspectSpec, on_file: KnowledgeBase) -> tuple[str | None, str]:
    """Why a suspect is not backed by the passages it cites (or None), and a
    name for where it came from.

    Two things are held to the passages: every number in the description, by the
    rule every model-written sentence is held to (`grounding.unbacked`), and
    every rate the suspect is simulated at. A rate has to be stated in a
    passage; one a model worked out from two other figures is refused.
    """
    cited = {c: on_file.get(c) for c in spec.cites}
    missing = [c for c, p in cited.items() if p is None]
    if missing:
        return (
            f"It cites {', '.join(missing)}, which is not a passage on file for this machine.",
            "",
        )
    by_id = {p.id: Evidence(p.id, "document", p.text, numbers_in(p.text)) for p in cited.values()}
    reason = unbacked(Sentence(spec.description, tuple(spec.cites)), by_id)
    if reason:
        return f"Its description is not backed by what it cites: {reason}.", ""
    stated = tuple(v for e in by_id.values() for v in e.numbers)
    rates = [t.order for t in spec.tones] + [i.rate_order for i in spec.impacts]
    stray = [f"{r:g}" for r in rates if not matches(f"{r:g}", stated)]
    if stray:
        return (
            f"Its rate of {', '.join(stray)} per shaft turn is not stated in what it cites.",
            "",
        )
    first = cited[spec.cites[0]]
    return None, f'{first.id}: {first.document}, "{first.section}"'


def _order_suspect(spec: SuspectSpec) -> OrderSuspect:
    """The written suspect as physics: orders and relative heights only."""
    return OrderSuspect(
        name=spec.name,
        description=spec.description,
        tones=tuple((t.order, t.relative_amplitude) for t in spec.tones),
        impacts=tuple(
            (i.rate_order, i.relative_amplitude, i.modulation_order, i.resonance_hz)
            for i in spec.impacts
        ),
    )


def _text_problem(text: str) -> str | None:
    if not text or not text.strip():
        return "The text is empty."
    if len(text) > MAX_TEXT_CHARS:
        return f"Keep it under {MAX_TEXT_CHARS} characters."
    return None


def _request_view(req: MeasurementRequest) -> RequestView:
    test = BY_ID[req.test_id]
    return RequestView(
        request_id=req.id,
        test_id=req.test_id,
        test_name=test.name,
        status=req.status,
        reading=req.reading,
        collected_by=req.collected_by,
        procedure=list(test.procedure),
        coach_prompt=test.coach_prompt,
        effort_min=test.effort_min,
        downtime=test.downtime,
    )


def _experiments(case: Case, ran: bool, detail: str) -> ExperimentResult:
    inv = case.investigation
    leader = inv.state.leader()
    return ExperimentResult(
        ran=ran,
        detail=detail,
        simulation_match={
            h.name: round(h.correlation, 3)
            for h in inv.state.hypotheses
            if h.correlation is not None
        },
        rejected=[h.name for h in inv.state.hypotheses if h.rejected],
        leader=leader.name,
        leader_belief=round(leader.posterior, 4),
    )


def _view(case: Case) -> CaseView:
    inv = case.investigation
    leader = inv.state.leader()
    sources = {w.spec.name: w.source for w in case.written_suspects if w.source}
    suspects = [
        SuspectView(
            name=h.name,
            label=h.label,
            origin=h.origin,
            status=(
                "untested"
                if not inv.experiments_run and h.origin == "written"
                else "rejected"
                if h.rejected
                else "live"
            ),
            belief=round(h.posterior, 4),
            simulation_match=None if h.correlation is None else round(h.correlation, 3),
            source=sources.get(h.name),
        )
        for h in inv.state.ranked()
    ]
    # Suspects the physics never took on: shown, so a refusal is visible too.
    suspects += [
        SuspectView(
            name=w.spec.name,
            label=w.spec.name.replace("_", " "),
            origin="written",
            status="refused",
            belief=None,
        )
        for w in case.written_suspects
        if w.status == "refused"
    ]
    return CaseView(
        case_id=case.id,
        machine=inv.machine.name,
        rpm=round(inv.observation.rpm, 1),
        status=case.status,
        leader=leader.name,
        leader_belief=round(leader.posterior, 4),
        conclude_at=CONCLUDE_ABOVE,
        blockers=inv.blockers() if case.status == "open" and inv.experiments_run else [],
        unresolved_reason=inv.state.unresolved_reason,
        investigator_reason=case.investigator_reason or None,
        critic_consulted=case.critic_turns > 0,
        experiments_run=inv.experiments_run,
        unexplained=_blocking_view(inv) if case.status == "open" else None,
        suspects=suspects,
        evidence=[
            EvidenceView(
                id=e.id, statement=e.statement, value=e.value, unit=e.unit, source=e.source
            )
            for e in inv.ledger.items
        ],
        requests=[_request_view(r) for r in case.requests],
        notes=[
            NoteView(id=n.id, text=n.text, by=n.by, hazards=list(n.hazards))
            for n in inv.state.notes
        ],
        hazard=hazard_flag(inv.state.notes),
        narration=list(case.narration),
        transcript=list(inv.state.transcript),
    )
