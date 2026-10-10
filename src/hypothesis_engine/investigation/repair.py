"""Was the repair a repair?

After a verdict the fix is made and the machine is captured again. That capture
is investigated as a case of its own, with the same suspects, scored the way the
first was: on the change from the machine's own normal when the first case had
its healthy captures, against the textbook machine otherwise. It starts from
even odds, so the first verdict does not lean on the second. Where someone can
answer (`answers`), it asks for a measurement when one capture is not enough,
exactly as the first case could; with nobody to ask it says what one capture
supports.

Nothing here is a typed expectation of how much a repair should help. The answer
is whatever the engine concludes about the machine as it now runs:

    verified        it fits this machine running normally
    still_there     the cause that was repaired still explains it
    something_else  that cause is gone and another one now explains it
    cause_gone      that cause is ruled out, and the capture settles nothing more
    cannot_tell     one capture does not support a verdict, nor rule the cause out

`cause_gone` is the most a sensor can say when it cannot tell a healthy machine
from some other fault: a 2 kHz accelerometer does not reach the band where
bearing damage shows, so it never concludes "healthy", but it can still see that
an imbalance has gone.

Beside the answer are the lines the repaired cause predicts, as each read before
and after, and in the machine's healthy captures when it has them, so the answer
can be seen as well as read. They are for the reader; the answer does not come
from them.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from ..models import FaultKind, Observation
from .catalog import BY_ID
from .engine import ACTIONS, Investigation, _pct

Outcome = Literal["verified", "still_there", "something_else", "cause_gone", "cannot_tell"]

#: Why a follow-up closed without a verdict when one capture was not enough.
ONE_CAPTURE = "This is one capture after the repair; no further reading was taken."


class NothingToVerify(ValueError):
    """The case named no fault, so there was no repair to check."""


@dataclass(frozen=True)
class LineChange:
    """One line the repaired cause predicts, as it read each time: its peak in
    multiples of the floor around it, where 1 means it is not there."""

    line: str
    before: float
    after: float
    #: What a healthy machine shows there: this machine's own healthy captures
    #: when the case has them, else the textbook machine simulated at the
    #: capture's length and noise. `RepairCheck.usual_from` says which.
    usual: float | None


@dataclass(frozen=True)
class RepairCheck:
    outcome: Outcome
    cause: str  # the hypothesis the repair was for
    found: str | None  # what the capture after it fits, when it fits something
    belief: float | None
    statement: str
    #: What a "verified" or a "cause gone" could not have seen, in the engine's
    #: words. Empty otherwise.
    limit: str
    #: True when that limit names the very cause that was repaired.
    limit_names_cause: bool
    #: Set when the follow-up's verdict leans on a reading scored against an
    #: unmeasured table (`Conclusion.caveat`). Empty otherwise.
    caveat: str
    lines: tuple[LineChange, ...]  # largest fall first
    #: Where `LineChange.usual` comes from: "healthy captures" or "simulation".
    usual_from: str
    #: The measurements the follow-up asked for and was given, by name.
    asked: tuple[str, ...]
    follow: Investigation  # the case on the capture after the repair, with its own ledger


def _belief(p: float) -> str:
    """A belief in words. Small is not none: nothing measured rounds down to 0%."""
    return "under 1%" if p < 0.005 else _pct(p)


def _times_floor(height: float) -> float | None:
    """A line height (log10 of peak over floor) as a plain multiple; None if unreadable."""
    return None if height != height else round(float(10.0**height), 1)


def check_repair(
    case: Investigation,
    after: Observation,
    answers: Callable[[str], float | Observation | None] | None = None,
    max_requests: int = 2,
) -> RepairCheck:
    """Investigate the machine as it runs after the repair `case` called for.

    `answers` supplies a requested measurement by test id, as it does for any
    case (a number, a capture, or None when it cannot be had). Without it the
    follow-up closes on the one capture it was given.
    """
    verdict = case.state.conclusion
    if verdict is None:
        raise NothingToVerify("The case has no verdict, so no repair followed from it.")
    if verdict.root_cause is FaultKind.HEALTHY:
        raise NothingToVerify("The verdict was that nothing is wrong, so there was no repair.")
    cause = case.hypothesis(verdict.cause)

    follow = Investigation(
        case.machine,
        after,
        candidates=tuple(h.kind for h in case.state.hypotheses if h.kind is not None),
        seed=case.seed,
        normal=case.normal,
    )
    follow.observe()
    follow.run_virtual_experiments()
    # A suspect written during the first case is on the list again: if it was
    # the cause, "still there" has to be a possible answer.
    for suspect in case.written_suspects:
        follow.add_hypothesis(suspect)
    if answers is None:
        follow.finish(ONE_CAPTURE)
    else:
        follow.settle(max_requests, answers)
    state = follow.state
    asked = tuple(BY_ID[o.test_id].name for o in state.outcomes)

    lines = case.cause_lines(cause.name)
    before = case.read(lines)
    now = follow.read(lines)
    usual = case.read_normal(lines)
    usual_from = "healthy captures"
    if usual is None:
        usual, usual_from = follow.healthy_heights(lines), "simulation"
    changes = []
    for i, line in enumerate(lines):
        was, is_now = _times_floor(before[i]), _times_floor(now[i])
        if was is None or is_now is None:
            continue  # a line these captures cannot show
        changes.append(
            LineChange(
                line=line.label(),
                before=was,
                after=is_now,
                usual=None if usual is None else _times_floor(usual[i]),
            )
        )
    # Largest fall first, as a ratio: a line that went from 90 to 2 fell further
    # than one that went from 950 to 150.
    changes.sort(key=lambda c: c.before / c.after, reverse=True)

    limit, names_cause, caveat = "", False, ""
    found: str | None = None
    belief: float | None = None
    closing = state.conclusion
    if closing is None:
        # No verdict on the machine as it now runs. The repaired cause may still
        # be ruled out by the engine's own threshold, which is worth saying.
        standing = next((h for h in state.hypotheses if h.name == cause.name), None)
        if standing is not None and standing.rejected:
            outcome: Outcome = "cause_gone"
            statement = (
                f"The fault that was repaired no longer shows: {cause.label} stands at "
                f"{_belief(standing.posterior)} after the repair. What the machine is now, this "
                f"capture does not settle. {state.unresolved_reason}"
            )
            mild = [severity for h, severity in follow.cannot_exclude() if h.name == cause.name]
            if mild:
                names_cause = True
                limit = (
                    f"A mild {cause.label} (severity {mild[0]:g}) would look the same as a "
                    "healthy machine in this capture."
                )
        else:
            outcome = "cannot_tell"
            where = (
                ""
                if standing is None
                else f" {cause.label.capitalize()} itself stands at {_belief(standing.posterior)}."
            )
            statement = f"Not verified either way.{where} {state.unresolved_reason}"
    else:
        found, belief = closing.cause, closing.confidence
        caveat = closing.caveat
        now_fits = follow.hypothesis(found)
        if closing.root_cause is FaultKind.HEALTHY:
            outcome = "verified"
            limit = closing.limit
            names_cause = any(name == cause.name for name, _ in closing.unseen)
            statement = (
                "Verified: after the repair the capture fits this machine running normally "
                f"({_pct(belief)} belief)."
            )
        elif found == cause.name:
            outcome = "still_there"
            statement = (
                f"Not verified: {cause.label} still explains the capture after the repair "
                f"({_pct(belief)} belief)."
            )
        else:
            outcome = "something_else"
            action = (
                ACTIONS[now_fits.kind]
                if now_fits.kind is not None
                else "Inspect and confirm it before any further repair."
            )
            statement = (
                f"{cause.label.capitalize()} no longer explains the capture, but "
                f"{now_fits.label} now does ({_pct(belief)} belief). {action}"
            )
    if asked:
        statement += (
            f" It took {'one more reading' if len(asked) == 1 else f'{len(asked)} more readings'} "
            f"to say so: {', '.join(asked)}."
        )
    if changes:
        statement += " " + _line_sentence(cause.label, changes, outcome, usual_from)
    return RepairCheck(
        outcome=outcome,
        cause=cause.name,
        found=found,
        belief=belief,
        statement=statement,
        limit=limit,
        limit_names_cause=names_cause,
        caveat=caveat,
        lines=tuple(changes),
        usual_from=usual_from,
        asked=asked,
        follow=follow,
    )


def _line_sentence(cause: str, changes: list[LineChange], outcome: Outcome, usual_from: str) -> str:
    """The one line that says most about the repair, with its numbers."""
    if outcome == "still_there":
        # What still stands above a healthy machine matters here, not what fell.
        c = max(changes, key=lambda c: c.after / (c.usual or 1.0))
        return (
            f"Of the lines {cause} predicts, the one at {c.line} still stands {c.after:g} times "
            f"above its floor{_usual(c, usual_from)}. It read {c.before:g} before the repair."
        )
    c = changes[0]
    return (
        f"Of the lines {cause} predicts, the one at {c.line} read {c.before:g} times its floor "
        f"before the repair and {c.after:g} after{_usual(c, usual_from)}."
    )


def _usual(change: LineChange, usual_from: str) -> str:
    if change.usual is None:
        return ""
    if usual_from == "healthy captures":
        return f", where this machine's healthy captures show {change.usual:g}"
    return f", where a healthy machine is simulated to show {change.usual:g}"
