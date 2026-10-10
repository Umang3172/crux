"""Try every place Crux calls Gemini, once, and say which ones work.

    uv run hypengine gemini-check

A model that is configured wrongly looks exactly like a model that is off: the
product falls back and carries on. That is the right behaviour for a user and
the wrong one for the person setting it up, so this makes each call site do one
small real piece of its own job and reports what happened: the model it used,
how long it took, and the error when there was one.

With no credentials it makes no call and says what to set. It never moves a
belief: the investigator check runs a whole case, but on a made-up capture in a
store of its own.
"""

from __future__ import annotations

import io
import time
from collections.abc import Callable
from dataclasses import dataclass

from . import factory

#: What to set, said once, when Gemini is off.
HOW_TO_TURN_ON = (
    "set GOOGLE_GENAI_USE_ENTERPRISE=true with GOOGLE_CLOUD_PROJECT (Google Cloud's own "
    "login), or GOOGLE_API_KEY"
)


@dataclass(frozen=True)
class Result:
    """What one call site did when asked to do its job once."""

    role: str
    model: str
    status: str  # ok | failed | off | skipped
    detail: str
    seconds: float = 0.0


def _still() -> bytes:
    """A small grey photograph of nothing: enough for a vision model to answer about."""
    from PIL import Image

    image = Image.new("RGB", (320, 240), (118, 124, 130))
    out = io.BytesIO()
    image.save(out, format="JPEG")
    return out.getvalue()


def _investigator() -> str:
    from ..data.rig import BENCH_RIG, rig_oracle, synthetic_capture
    from ..tools import InMemoryCaseStore, open_case
    from .investigator import investigate

    store = InMemoryCaseStore()
    capture = synthetic_capture("rolling_element", BENCH_RIG, seed=1, extra_noise=0.45)
    answers = rig_oracle("rolling_element", BENCH_RIG, extra_noise=0.45)
    case = open_case(store, BENCH_RIG, capture, answers)
    run = investigate(store, case.id, model=factory.gemini_model_id(), max_seconds=90.0)
    if run.fallback:
        raise RuntimeError(run.fallback)
    if not run.steps:
        raise RuntimeError("the model made no tool call")
    return (
        f"{len(run.steps)} tool calls; the case ended {run.case.status} on "
        f"{run.case.leader.replace('_', ' ')}"
    )


def _report_writer() -> str:
    from ..data.rig import BENCH_RIG, rig_oracle, synthetic_capture
    from ..investigation.engine import Investigation
    from . import report

    if factory.switched_off("report_writer"):
        raise RuntimeError("switched off by CRUX_REPORT_MODEL=off")
    # A case the engine closes by itself, so only the explanation is the model's.
    capture = synthetic_capture("outer_race", BENCH_RIG, seed=1)
    state = Investigation(BENCH_RIG, capture).run(oracle=rig_oracle("outer_race", BENCH_RIG))
    written = report.write_report(state, report.GeminiExplainer())
    kept = [line for line in written.lines if line.part == "plain"]
    if not kept and not written.removed:
        raise RuntimeError(" ".join(written.notes) or "the model wrote no sentence")
    return f"{len(kept)} of {len(kept) + len(written.removed)} sentences passed the evidence check"


def _ticket_writer() -> str:
    from ..ticket.draft import Evidence, GeminiWriter, check

    evidence = [
        Evidence("E1", "sensor", "Vibration is 2.3 times its normal level.", (2.3,)),
        Evidence("E2", "status", "The alarm went off at running hour 27.", (27.0,)),
        Evidence("E3", "record", "Bearing to have ready: SKF 6205-2RS JEM.", (6205.0, 2.0)),
    ]
    written = GeminiWriter().write(evidence, {})
    kept, removed = check(written, evidence)
    if not written:
        raise RuntimeError("the model wrote no sentence")
    return f"{len(kept)} of {len(written)} sentences passed the evidence check"


def _camera_look() -> str:
    from ..ticket.camera import GeminiInspector, Still

    still = Still("preflight", "test card", _still(), "image/jpeg", "")
    found = GeminiInspector().look(still, "a plain grey test card, nothing on it")
    return f"{len(found)} finding(s) on a blank test card (none is the right answer)"


def _lens_look() -> str:
    from ..lens import look

    reply, who = look._gemini(look.PROMPT, look._SCHEMA, _still())
    return f"answered with {len(reply)} field(s)"


def _lesson_writer() -> str:
    from ..fleet import learn

    before = dict(factory._FAILURES)
    lesson = learn._worded(
        {"situation": "vibration rising alarm", "said": "outer race", "found": "outer race"}
    )
    if lesson is None:
        why = factory._FAILURES.get("lesson_writer")
        raise RuntimeError(
            why if why and why != before.get("lesson_writer") else "no lesson came back"
        )
    return f"a lesson with {len(lesson)} field(s)"


#: Each call site, the model it would use, and one small piece of its own job.
CHECKS: tuple[tuple[str, Callable[[], str]], ...] = (
    ("investigator", _investigator),
    ("report_writer", _report_writer),
    ("ticket_writer", _ticket_writer),
    ("camera_look", _camera_look),
    ("lens_look", _lens_look),
    ("lesson_writer", _lesson_writer),
)


def run(only: tuple[str, ...] = ()) -> list[Result]:
    """Run every check, or the named ones. Makes no call when Gemini is off."""
    route = factory.gemini_route()
    results = []
    for role, check in CHECKS:
        if only and role not in only:
            continue
        model = factory.gemini_model_id(None if role == "investigator" else role)
        if route is None:
            why = factory._FAILURES.get("gemini", "no Gemini credentials")
            results.append(Result(role, model, "off", why))
            continue
        started = time.perf_counter()
        try:
            detail, status = check(), "ok"
        except ImportError as exc:
            detail, status = f"an optional package is not installed ({exc})", "skipped"
        except Exception as exc:
            detail, status = f"{type(exc).__name__}: {exc}"[:300], "failed"
        results.append(Result(role, model, status, detail, time.perf_counter() - started))
    return results
