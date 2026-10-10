"""The scoreboard command: one case scored, and how its outcome is counted."""

from __future__ import annotations

from hypothesis_engine.cli import (
    EVALUATE_FAULTS,
    EVALUATE_NOISE,
    EVALUATE_SEEDS,
    EVALUATE_SEVERITIES,
    Scored,
    score_synthetic,
)
from hypothesis_engine.models import FaultKind


def test_a_clear_case_is_right_without_asking_and_the_best_match_agrees():
    scored = score_synthetic(FaultKind.OUTER_RACE, severity=1.0, noise=0.05, seed=11)
    assert scored.outcome == "right" and scored.verdict == "outer_race"
    assert scored.best_match == "outer_race" and scored.asked == 0


def test_saying_it_cannot_tell_is_counted_apart_from_being_wrong():
    assert Scored(FaultKind.IMBALANCE, None, "healthy", 2).outcome == "unresolved"
    assert Scored(FaultKind.IMBALANCE, "misalignment", "imbalance", 0).outcome == "wrong"
    assert Scored(FaultKind.IMBALANCE, "imbalance", "healthy", 1).outcome == "right"


def test_the_full_run_is_the_180_cases_the_decision_record_reports():
    cases = (
        len(EVALUATE_FAULTS) * len(EVALUATE_SEVERITIES) * len(EVALUATE_NOISE) * len(EVALUATE_SEEDS)
    )
    assert cases == 180
