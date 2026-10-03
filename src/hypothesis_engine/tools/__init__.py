"""What a language model may do to an investigation, and how readings get in.

Two doors, on purpose:

* `InvestigatorTools`: the functions a model may call. None of them takes a
  probability, a score or a reading as an argument.
* `record_measurement`: how a reading arrives, from a technician, a sensor or
  the replay rig. It is not an agent tool.

See ADR-0007 in docs/DECISIONS.md.
"""

from .cases import (
    AnswerSource,
    Case,
    CaseNotFound,
    CaseStore,
    InMemoryCaseStore,
    MeasurementRequest,
    mark_unanswerable,
    open_case,
    record_measurement,
)
from .contract import ImpactSpec, SuspectSpec, ToneSpec
from .investigator import AGENT_TOOL_NAMES, MAX_TEXT_CHARS, InvestigatorTools

__all__ = [
    "AGENT_TOOL_NAMES",
    "MAX_TEXT_CHARS",
    "AnswerSource",
    "Case",
    "CaseNotFound",
    "CaseStore",
    "ImpactSpec",
    "InMemoryCaseStore",
    "InvestigatorTools",
    "MeasurementRequest",
    "SuspectSpec",
    "ToneSpec",
    "mark_unanswerable",
    "open_case",
    "record_measurement",
]
