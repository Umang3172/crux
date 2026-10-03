"""The investigation loop.

    observe -> hypothesise -> virtual experiment -> ask for evidence -> conclude

Every step is deterministic and testable. A language model can narrate, re-order
or extend this loop (see `agents/`), but it is never the thing that decides: the
beliefs move only through physics comparisons and measured evidence.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass

import numpy as np

from ..models import (
    Conclusion,
    Evidence,
    FaultKind,
    Hypothesis,
    InvestigationState,
    MachineSpec,
    Observation,
    TestOutcome,
)
from ..physics.compare import spectral_correlation
from ..physics.frequencies import fault_frequencies
from ..physics.signatures import DEFAULT_HYPOTHESES, predicted_signature
from ..physics.synth import synthesize
from ..signals import features as feat
from .catalog import BY_ID, CATALOG, EvidenceTest

#: How sharply a spectral correlation moves belief. Higher = more decisive.
#: Calibrated against the rig in week 2; see docs/DECISIONS.md (ADR-0004).
LIKELIHOOD_SHARPNESS = 9.0

#: Below this posterior a hypothesis is called rejected and stops being simulated.
REJECT_BELOW = 0.03

#: Above this the investigation concludes.
CONCLUDE_ABOVE = 0.80

ACTIONS: dict[FaultKind, str] = {
    FaultKind.IMBALANCE: "Balance the rotor; check for debris or a missing balance weight first.",
    FaultKind.MISALIGNMENT: "Re-align the coupling, then re-check with the machine at running temperature.",
    FaultKind.LOOSENESS: "Torque the mounting bolts to spec and re-check the soft foot.",
    FaultKind.OUTER_RACE: "Plan a drive-end bearing replacement at the next window; watch temperature until then.",
    FaultKind.INNER_RACE: "Plan a drive-end bearing replacement; inner-race damage usually progresses faster.",
    FaultKind.HEALTHY: "No action. Keep the baseline and re-check on the normal route.",
}


class Ledger:
    """Append-only evidence list with stable ids."""

    def __init__(self) -> None:
        self.items: list[Evidence] = []

    def add(self, statement: str, value=None, unit: str = "", source: str = "sensor") -> Evidence:
        ev = Evidence(
            id=f"E{len(self.items) + 1:02d}",
            statement=statement,
            value=value,
            unit=unit,
            source=source,
        )
        self.items.append(ev)
        return ev

    def ids(self) -> list[str]:
        return [e.id for e in self.items]


def _entropy(p: np.ndarray) -> float:
    p = np.clip(p, 1e-12, 1.0)
    return float(-np.sum(p * np.log(p)))


def _normalise(weights: dict[FaultKind, float]) -> dict[FaultKind, float]:
    total = sum(weights.values())
    if total <= 0:
        n = len(weights)
        return {k: 1.0 / n for k in weights}
    return {k: v / total for k, v in weights.items()}


@dataclass
class TestChoice:
    test: EvidenceTest
    expected_info_gain: float
    gain_per_minute: float
    reason: str


class Investigation:
    """One case, from first anomaly to verified repair."""

    def __init__(
        self,
        machine: MachineSpec,
        observation: Observation,
        priors: dict[FaultKind, float] | None = None,
        candidates: tuple[FaultKind, ...] = DEFAULT_HYPOTHESES,
        seed: int = 7,
    ) -> None:
        self.machine = machine
        self.observation = observation
        self.seed = seed
        self.ledger = Ledger()
        self.state = InvestigationState(
            id=f"inv_{uuid.uuid4().hex[:8]}",
            machine=machine,
            rpm=observation.rpm,
            hypotheses=[],
        )
        priors = priors or {k: 1.0 / len(candidates) for k in candidates}
        self.state.hypotheses = [
            Hypothesis(kind=k, prior=priors.get(k, 1e-3), posterior=priors.get(k, 1e-3))
            for k in candidates
        ]
        self.evidence = feat.extract(observation, machine)
        self.state.rpm = self.rpm

    # ------------------------------------------------------------------ observe
    @property
    def rpm(self) -> float:
        """The speed every frequency is read at: the signal's own, when it shows one."""
        return self.evidence.rpm or self.observation.rpm

    def observe(self) -> None:
        ff = fault_frequencies(self.machine.bearing, self.rpm)
        e = self.evidence
        self.ledger.add("shaft speed, reported", round(self.observation.rpm, 1), " rpm", "sensor")
        if e.speed is not None and e.speed.from_signal:
            self.ledger.add(
                "shaft speed, measured from the 1x peak", round(e.speed.rpm, 1), " rpm", "physics"
            )
        elif e.speed is not None:
            self.ledger.add(f"reported speed kept: {e.speed.note}", None, "", "physics")
        self.ledger.add("shaft frequency (1x)", round(ff.shaft, 2), " Hz", "physics")
        self.ledger.add("predicted BPFO", round(ff.bpfo, 2), " Hz", "physics")
        self.ledger.add("predicted BPFI", round(ff.bpfi, 2), " Hz", "physics")
        self.ledger.add("2x relative to 1x", round(e.ratio_2x_1x(), 3), "", "sensor")
        self.ledger.add("half-order peak, relative to 1x", round(e.amp_half_x, 3), "", "sensor")
        if e.env_bpfo is not None and e.env_bpfi is not None:
            self.ledger.add("envelope peak at BPFO", round(e.env_bpfo, 2), "x median", "sensor")
            self.ledger.add("envelope peak at BPFI", round(e.env_bpfi, 2), "x median", "sensor")
        else:
            self.ledger.add(
                f"envelope not available: a {self.observation.sample_rate_hz:.0f} Hz capture "
                "cannot see the bearing resonance band",
                None,
                "",
                "physics",
            )
        self.ledger.add("crest factor", round(e.crest_factor, 2), "", "sensor")
        if self.observation.temperature_c is not None:
            self.ledger.add(
                "housing temperature", round(self.observation.temperature_c, 1), " C", "sensor"
            )
        envelope = (
            f"envelope at BPFO = {e.env_bpfo:.1f}x median"
            if e.env_bpfo is not None
            else "no envelope at this sample rate"
        )
        self.state.transcript.append(
            f"Anomaly on {self.machine.name} at {self.rpm:.0f} rpm. "
            f"2x/1x = {e.ratio_2x_1x():.2f}, {envelope}, crest factor {e.crest_factor:.1f}."
        )

    # -------------------------------------------------------- virtual experiments
    def run_virtual_experiments(self, duration_s: float | None = None) -> dict[FaultKind, float]:
        """Simulate every live hypothesis and score it against the real capture."""
        dur = duration_s or min(2.0, self.observation.duration_s)
        real = self.observation.waveform
        fs = self.observation.sample_rate_hz
        scores: dict[FaultKind, float] = {}

        for h in self.state.hypotheses:
            if h.rejected:
                continue
            sig = predicted_signature(h.kind, self.machine, self.rpm)
            sim = synthesize(sig, sample_rate_hz=fs, duration_s=dur, seed=self.seed + 101)
            corr = spectral_correlation(real, sim, fs)
            h.correlation = corr
            scores[h.kind] = corr
            ev = self.ledger.add(
                f"simulated {h.label}: spectral correlation",
                round(corr, 3),
                "",
                "virtual_experiment",
            )
            h.supports.append(ev.id)

        weights = {
            h.kind: h.prior * math.exp(LIKELIHOOD_SHARPNESS * scores.get(h.kind, 0.0))
            for h in self.state.hypotheses
            if not h.rejected
        }
        self._apply(_normalise(weights))

        ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
        best = ", ".join(f"{k.value} {v:.2f}" for k, v in ranked[:3])
        self.state.transcript.append(f"Virtual experiments (correlation): {best}.")
        return scores

    def _apply(self, posteriors: dict[FaultKind, float]) -> None:
        for h in self.state.hypotheses:
            if h.kind in posteriors:
                h.posterior = posteriors[h.kind]
            if h.posterior < REJECT_BELOW and not h.rejected:
                h.rejected = True
                self.state.transcript.append(f"Rejected {h.label}: belief fell below 3%.")

    # ----------------------------------------------------------- choose a test
    def choose_next_test(self) -> TestChoice | None:
        """Expected information gain per technician-minute.

        For each candidate test we imagine the outcome under every surviving
        hypothesis (three quadrature points around its prediction), work out the
        posterior that outcome would produce, and average the resulting entropy.
        """
        live = [h for h in self.state.surviving() if h.kind in BY_ID["vib_10s"].predictions]
        if len(live) < 2:
            return None

        kinds = [h.kind for h in live]
        p = np.array([h.posterior for h in live], dtype=float)
        p = p / p.sum()
        h_before = _entropy(p)

        quad_z = np.array([-1.0, 0.0, 1.0])
        quad_w = np.array([0.24, 0.52, 0.24])

        best: TestChoice | None = None
        for test in CATALOG:
            if test.id in self.state.requested_tests:
                continue
            if not self.evidence.envelope_available and test.feature in feat.ENVELOPE_FEATURES:
                continue  # this sensor cannot answer it, so it is not worth asking for
            preds = np.array([test.predict(k) for k in kinds], dtype=float)
            if np.any(np.isnan(preds)):
                continue

            expected_h = 0.0
            for i, _kind in enumerate(kinds):
                for z, w in zip(quad_z, quad_w, strict=True):
                    value = preds[i] + z * test.sigma
                    like = np.exp(-0.5 * ((value - preds) / test.sigma) ** 2)
                    post = p * like
                    if post.sum() <= 0:
                        continue
                    post = post / post.sum()
                    expected_h += p[i] * w * _entropy(post)

            gain = h_before - expected_h
            per_min = gain / max(test.effort_min, 0.1)
            spread = float(np.max(preds) - np.min(preds)) / test.sigma
            reason = (
                f"separates the survivors by {spread:.1f} sigma; "
                f"{test.effort_min:.0f} min, downtime: {test.downtime}"
            )
            choice = TestChoice(test, gain, per_min, reason)
            if best is None or per_min > best.gain_per_minute:
                best = choice

        if best:
            self.state.transcript.append(
                f"Cannot separate {' vs '.join(h.label for h in live[:3])}. "
                f"Requesting: {best.test.name} ({best.reason})."
            )
        return best

    def request(self, choice: TestChoice) -> None:
        self.state.requested_tests.append(choice.test.id)
        self.ledger.add(
            f"requested measurement: {choice.test.name}",
            round(choice.expected_info_gain, 3),
            " nats expected",
            "physics",
        )

    # ------------------------------------------------------ incorporate evidence
    def apply_outcome(self, test_id: str, value: float, collected_by: str = "technician") -> None:
        test = BY_ID[test_id]
        live = [h for h in self.state.surviving()]
        kinds = [h.kind for h in live]
        p = np.array([h.posterior for h in live], dtype=float)
        preds = np.array([test.predict(k) for k in kinds], dtype=float)
        like = np.exp(-0.5 * ((value - preds) / test.sigma) ** 2)
        post = p * like
        post = post / post.sum() if post.sum() > 0 else p

        ev = self.ledger.add(
            f"{test.name}: {test.feature}",
            round(float(value), 3),
            "",
            "human_measurement" if collected_by == "technician" else "sensor",
        )
        for h, new_p, l_i in zip(live, post, like, strict=True):
            h.posterior = float(new_p)
            (h.supports if l_i >= like.max() * 0.5 else h.tensions).append(ev.id)

        self._apply({h.kind: h.posterior for h in live})
        self.state.outcomes.append(TestOutcome(test_id=test_id, feature=test.feature, value=value))
        leader = self.state.leader()
        self.state.transcript.append(
            f"Measured {test.feature} = {value:.2f}. "
            f"Leader is now {leader.label} at {leader.posterior:.0%}."
        )

    def measure_from_capture(self, test_id: str, observation: Observation) -> float:
        """Read a test's feature out of a real capture (the rig or a phone upload)."""
        ev = feat.extract(observation, self.machine)
        test = BY_ID[test_id]
        table = {
            "ratio_2x_1x": ev.ratio_2x_1x(),
            "env_contrast": ev.env_contrast(),
            "env_bpfo": ev.env_bpfo,
            "env_bpfi": ev.env_bpfi,
            "amp_half_x": ev.amp_half_x,
            "crest_factor": ev.crest_factor,
        }
        if test.feature not in table:
            raise ValueError(f"{test.feature} cannot be read from a capture; a person reports it")
        value = table[test.feature]
        if value is None:
            raise ValueError(
                f"{test.feature} needs an envelope, and a {observation.sample_rate_hz:.0f} Hz "
                "capture cannot see the resonance band"
            )
        return float(value)

    # ------------------------------------------------------------------ conclude
    def conclude(self) -> Conclusion:
        leader = self.state.leader()
        runner_up = sorted(self.state.hypotheses, key=lambda h: h.posterior, reverse=True)[1]

        change_my_mind = "Nothing in the current catalogue would move this materially."
        best_gap = 0.0
        for test in CATALOG:
            a, b = test.predict(leader.kind), test.predict(runner_up.kind)
            if a is None or b is None:
                continue
            gap = abs(a - b) / test.sigma
            if gap > best_gap:
                best_gap = gap
                direction = "above" if b > a else "below"
                change_my_mind = (
                    f"{test.feature} coming back {direction} {b:.2f} "
                    f"would move this toward {runner_up.label}."
                )

        conclusion = Conclusion(
            root_cause=leader.kind,
            confidence=leader.posterior,
            reasoning=(
                f"{leader.label} reproduced the measured spectrum best "
                f"(correlation {leader.correlation:.2f}) and survived every measurement requested."
                if leader.correlation is not None
                else f"{leader.label} survived every measurement requested."
            ),
            recommended_action=ACTIONS[leader.kind],
            what_would_change_my_mind=change_my_mind,
            evidence_ids=self.ledger.ids(),
        )
        self.state.conclusion = conclusion
        self.state.ledger = self.ledger.items
        self.state.transcript.append(
            f"Conclusion: {leader.label} at {leader.posterior:.0%}. {conclusion.recommended_action}"
        )
        return conclusion

    # --------------------------------------------------------------------- run
    def run(self, max_requests: int = 2, oracle=None) -> InvestigationState:
        """Drive the whole loop.

        `oracle` supplies requested measurements: a callable (test_id) -> value.
        In the demo it is the rig; in production it is a coached technician.
        """
        self.observe()
        self.run_virtual_experiments()

        for _ in range(max_requests):
            if self.state.leader().posterior >= CONCLUDE_ABOVE:
                break
            choice = self.choose_next_test()
            if choice is None:
                break
            self.request(choice)
            if oracle is None:
                break
            value = oracle(choice.test.id)
            if value is None:
                break
            self.apply_outcome(choice.test.id, value)

        self.conclude()
        self.state.ledger = self.ledger.items
        return self.state


def verify_repair(
    before: Observation,
    after: Observation,
    machine: MachineSpec,
    fault: FaultKind,
) -> dict[str, float | bool | str]:
    """Did the repair do what the physics said it would?"""
    b = feat.extract(before, machine)
    a = feat.extract(after, machine)
    expected = {
        FaultKind.IMBALANCE: 0.60,
        FaultKind.MISALIGNMENT: 0.50,
        FaultKind.LOOSENESS: 0.45,
        FaultKind.OUTER_RACE: 0.65,
        FaultKind.INNER_RACE: 0.65,
        FaultKind.HEALTHY: 0.0,
    }[fault]
    actual = 1.0 - (a.rms / (b.rms + 1e-12))
    return {
        "rms_before": round(b.rms, 4),
        "rms_after": round(a.rms, 4),
        "expected_reduction": expected,
        "actual_reduction": round(float(actual), 3),
        "verified": bool(actual >= expected * 0.6),
        "note": "Verified against the reduction the physics predicted for this fault.",
    }
