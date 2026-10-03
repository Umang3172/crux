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

from ..investigation.catalog import BY_ID
from ..investigation.engine import CONCLUDE_ABOVE
from ..physics.frequencies import fault_frequencies, shaft_hz
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
    NextTest,
    RequestResult,
    RequestView,
    SuspectReview,
    SuspectSpec,
    SuspectView,
)

#: Longest narration or reason a model may write in one call. An operational
#: limit on what the screen shows, not a physical constant.
MAX_TEXT_CHARS = 600

#: The methods a model may call, in the order a case usually uses them.
AGENT_TOOL_NAMES: tuple[str, ...] = (
    "get_case",
    "extract_features",
    "run_virtual_experiments",
    "choose_next_test",
    "request_measurement",
    "measurement_status",
    "propose_suspect",
    "narrate",
    "conclude",
    "declare_unresolved",
)


class InvestigatorTools:
    """Agent tools bound to one case store. Hand `agent_functions()` to the agent."""

    def __init__(self, store: CaseStore) -> None:
        self._store = store

    def agent_functions(self) -> list[Callable[..., Any]]:
        return [getattr(self, name) for name in AGENT_TOOL_NAMES]

    # ------------------------------------------------------------------ read

    def get_case(self, case_id: str) -> CaseView:
        """Everything about the case: suspects and their beliefs, the evidence
        ledger, measurement requests, narration and the engine's transcript."""
        return _view(self._store.get(case_id))

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
        if leader.posterior >= CONCLUDE_ABOVE:
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
                available=False, detail="No test in the catalogue separates the live suspects."
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

        # The only limits applied are the ones this capture imposes: a component
        # above the Nyquist frequency cannot appear in it, whatever its cause.
        fr = shaft_hz(inv.observation.rpm)
        nyquist = inv.observation.sample_rate_hz / 2.0
        for tone in suspect.tones:
            hz = tone.order * fr
            if hz >= nyquist:
                reasons.append(f"A tone at {tone.order}x ({hz:.0f} Hz) is above {nyquist:.0f} Hz.")
        for impact in suspect.impacts:
            hz = impact.rate_order * fr
            if hz >= nyquist:
                reasons.append(
                    f"Impacts at {impact.rate_order}x ({hz:.0f} Hz) are above {nyquist:.0f} Hz."
                )
            if impact.resonance_hz is not None and impact.resonance_hz >= nyquist:
                reasons.append(
                    f"A resonance at {impact.resonance_hz:.0f} Hz is above {nyquist:.0f} Hz."
                )

        status = "refused"
        if not reasons:
            accepted, outcome = inv.add_hypothesis(_order_suspect(suspect))
            reasons.append(outcome)
            if accepted:
                status = "tested" if inv.experiments_run else "pending_experiments"
        case.written_suspects.append(WrittenSuspect(suspect, status, reasons))
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
        is below the bar, while the capture holds something the leader cannot
        explain, or after a reading that fits no suspect."""
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
        list explains the evidence, or nothing left can separate the suspects."""
        case = self._store.get(case_id)
        inv = case.investigation
        if case.status != "open":
            return Ack(ok=False, detail=f"The case is {case.status}.")
        problem = _text_problem(reason)
        if problem:
            return Ack(ok=False, detail=problem)
        inv.declare_unresolved(reason.strip())
        self._store.put(case)
        return Ack(ok=True, detail="The case is closed as unresolved.")


# ------------------------------------------------------------------ helpers


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
        suspects=suspects,
        evidence=[
            EvidenceView(
                id=e.id, statement=e.statement, value=e.value, unit=e.unit, source=e.source
            )
            for e in inv.ledger.items
        ],
        requests=[_request_view(r) for r in case.requests],
        narration=list(case.narration),
        transcript=list(inv.state.transcript),
    )
