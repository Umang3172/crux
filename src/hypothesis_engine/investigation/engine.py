"""The investigation loop.

    observe -> virtual experiments -> ask for evidence -> conclude, or say "unresolved"

Every step is deterministic and testable. A language model can narrate, re-order
or extend this loop (see `tools/` and `agents/`), but it is never the thing that
decides: beliefs move only here, from simulated likelihoods and measured evidence.

Three rules hold everywhere below:

* Beliefs are one distribution over every hypothesis, recomputed from each
  hypothesis' prior and the log-likelihood of all the evidence so far. Nothing
  is frozen out, so a hypothesis written off early can come back.
* A suspect written during the case is simulated like any other and scored on
  everything already seen, the first capture and every reading. It gains belief
  only by explaining the evidence better.
* There is no verdict below `CONCLUDE_ABOVE`, none while the capture holds a
  strong periodic impact the leader cannot explain, and none after a reading
  that fits no hypothesis. Such a case ends "unresolved", with the reason.
"""

from __future__ import annotations

import math
import uuid
from collections.abc import Callable
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
from ..physics.frequencies import fault_frequencies, shaft_hz
from ..physics.likelihood import (
    SEEDS_PER_SEVERITY,
    SEVERITY_GRID,
    Line,
    Prediction,
    Unexplained,
    evidence_lines,
    log_likelihood,
    measure_lines,
    noise_level,
    predict,
    predicted_lines,
    unexplained_envelope_line,
)
from ..physics.signatures import (
    DEFAULT_HYPOTHESES,
    OrderSuspect,
    Signature,
    predicted_signature,
    signature_from_orders,
)
from ..physics.synth import synthesize
from ..signals import features as feat
from .catalog import BY_ID, CATALOG, EvidenceTest

#: Below this belief a hypothesis is shown as rejected. It stays in the
#: distribution and can come back if later evidence favours it.
REJECT_BELOW = 0.03

#: A verdict needs at least this belief in the leading hypothesis.
CONCLUDE_ABOVE = 0.80

#: A measured value further than this many sigma from every hypothesis'
#: prediction fits none of them. Under a Gaussian the two-sided tail beyond
#: 4 sigma is about 6e-5, so this is almost never noise.
FITS_NONE_SIGMA = 4.0

#: A written suspect must differ from every existing hypothesis by at least this
#: many combined standard deviations on some predicted line, or no measurement of
#: the capture could ever tell them apart and it is refused as a duplicate.
DISTINCT_SIGMA = 1.0

#: The correlation shown beside each hypothesis is computed on one simulation at
#: this seed offset; `deploy/server.py` draws the same simulation. It is a
#: picture of the comparison and no longer moves a belief (ADR-0008).
PICTURE_SEED_OFFSET = 101

# Three-point Gauss-Hermite rule for a standard normal: exact for polynomials up
# to degree five, so the outcome spread it imagines has the right variance.
_GH_NODES = np.array([-math.sqrt(3.0), 0.0, math.sqrt(3.0)])
_GH_WEIGHTS = np.array([1.0 / 6.0, 2.0 / 3.0, 1.0 / 6.0])

ACTIONS: dict[FaultKind, str] = {
    FaultKind.IMBALANCE: "Balance the rotor; check for debris or a missing balance weight first.",
    FaultKind.MISALIGNMENT: "Re-align the coupling, then re-check with the machine at running temperature.",
    FaultKind.LOOSENESS: "Torque the mounting bolts to spec and re-check the soft foot.",
    FaultKind.OUTER_RACE: "Plan a drive-end bearing replacement at the next window; watch temperature until then.",
    FaultKind.INNER_RACE: "Plan a drive-end bearing replacement; inner-race damage usually progresses faster.",
    FaultKind.HEALTHY: "No action. Keep the baseline and re-check on the normal route.",
}


class CannotConclude(ValueError):
    """The evidence does not support a verdict. The message says why."""


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


def _pct(p: float) -> str:
    """A belief as a percentage, without rounding a model's output up to certainty."""
    return ">99%" if p >= 0.995 else f"{p:.0%}"


@dataclass(frozen=True)
class _Reading:
    """How each hypothesis scores one value of one test's feature.

    A hypothesis with no prediction for the feature gets a flat density across
    the span the others cover, padded by four sigma: it neither claims the
    value nor rules it out, and pays for being vague.
    """

    test: EvidenceTest
    predictions: tuple[float | None, ...]

    @property
    def span(self) -> tuple[float, float]:
        known = [p for p in self.predictions if p is not None]
        return min(known) - 4.0 * self.test.sigma, max(known) + 4.0 * self.test.sigma

    def densities(self, value: float) -> np.ndarray:
        return np.exp(self.log_densities(value))

    def log_densities(self, value: float) -> np.ndarray:
        # In logs, so a reading far from a prediction costs a large finite
        # amount instead of underflowing to an impossible zero.
        lo, hi = self.span
        flat = -math.log(hi - lo)
        sigma = self.test.sigma
        norm = math.log(sigma * math.sqrt(2.0 * math.pi))
        return np.array(
            [
                flat if p is None else -0.5 * ((value - p) / sigma) ** 2 - norm
                for p in self.predictions
            ]
        )


@dataclass
class TestChoice:
    test: EvidenceTest
    expected_info_gain: float
    gain_per_minute: float
    reason: str


class Investigation:
    """One case, from first anomaly to verdict, "unresolved", or verified repair."""

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
        total = sum(priors.get(k, 1e-3) for k in candidates)
        self.state.hypotheses = [
            Hypothesis(
                kind=k, prior=priors.get(k, 1e-3) / total, posterior=priors.get(k, 1e-3) / total
            )
            for k in candidates
        ]
        self.evidence = feat.extract(observation, machine)

        # Beliefs are recomputed from these: log prior + log-likelihood of the
        # first capture + log-likelihood of every reading, per hypothesis name.
        self._log_prior = {h.name: math.log(h.prior) for h in self.state.hypotheses}
        self._first_look: dict[str, float] | None = None
        self._reading_log = {h.name: 0.0 for h in self.state.hypotheses}
        self._readings: list[tuple[EvidenceTest, float, str]] = []
        self._written: dict[str, OrderSuspect] = {}
        self._noise: float | None = None
        self._fit_ids: dict[str, str] = {}
        self._misfits: list[str] = []
        self._unexplained: dict[str, Unexplained | None] = {}

    # ------------------------------------------------------------------ helpers
    @property
    def rpm(self) -> float:
        """The speed every predicted frequency is computed at: the one measured
        from the signal when the feature extractor provides it, else the reported
        speed. Bearing lines are 3.6x to 5.4x shaft speed, so a few percent of
        speed error moves them out of their search band."""
        measured = getattr(self.evidence, "rpm", None)
        return float(measured) if measured else self.observation.rpm

    def hypothesis(self, name: str) -> Hypothesis:
        for h in self.state.hypotheses:
            if h.name == name:
                return h
        raise KeyError(f"no hypothesis named {name!r}")

    def _signature_builder(self, h: Hypothesis) -> Callable[[float | None], Signature]:
        rpm = self.rpm

        def build(severity: float | None) -> Signature:
            s = 1.0 if severity is None else severity
            if h.kind is not None:
                return predicted_signature(h.kind, self.machine, rpm, severity=s)
            return signature_from_orders(self._written[h.name], rpm, severity=s)

        return build

    @staticmethod
    def _severities(h: Hypothesis) -> list[float | None]:
        return [None] if h.kind is FaultKind.HEALTHY else list(SEVERITY_GRID)

    def _predictions(self, lines: tuple[Line, ...]) -> dict[str, Prediction]:
        obs = self.observation
        fs, n, fr = obs.sample_rate_hz, len(obs.waveform), shaft_hz(self.rpm)
        return {
            h.name: predict(
                self._signature_builder(h), self._severities(h), fs, n, self._noise, lines, fr
            )
            for h in self.state.hypotheses
        }

    def _lines(self) -> tuple[Line, ...]:
        fr = shaft_hz(self.rpm)
        return evidence_lines((self._signature_builder(h)(None) for h in self.state.hypotheses), fr)

    # ------------------------------------------------------------------ observe
    def observe(self) -> None:
        ff = fault_frequencies(self.machine.bearing, self.observation.rpm)
        e = self.evidence
        self.ledger.add("shaft speed", round(self.observation.rpm, 1), " rpm", "sensor")
        self.ledger.add("shaft frequency (1x)", round(ff.shaft, 2), " Hz", "physics")
        self.ledger.add("predicted BPFO", round(ff.bpfo, 2), " Hz", "physics")
        self.ledger.add("predicted BPFI", round(ff.bpfi, 2), " Hz", "physics")
        self.ledger.add("2x relative to 1x", round(e.ratio_2x_1x(), 3), "", "sensor")
        self.ledger.add("half-order peak, relative to 1x", round(e.amp_half_x, 3), "", "sensor")
        self.ledger.add("envelope peak at BPFO", round(e.env_bpfo, 2), "x median", "sensor")
        self.ledger.add("envelope peak at BPFI", round(e.env_bpfi, 2), "x median", "sensor")
        self.ledger.add("crest factor", round(e.crest_factor, 2), "", "sensor")
        if self.observation.temperature_c is not None:
            self.ledger.add(
                "housing temperature", round(self.observation.temperature_c, 1), " C", "sensor"
            )
        self.state.transcript.append(
            f"Anomaly on {self.machine.name} at {self.observation.rpm:.0f} rpm. "
            f"2x/1x = {e.ratio_2x_1x():.2f}, envelope at BPFO = {e.env_bpfo:.1f}x median, "
            f"crest factor {e.crest_factor:.1f}."
        )

    # ------------------------------------------------------------ beliefs
    def _recompute(self) -> None:
        """The only place a posterior is written: prior times the likelihood of
        all the evidence so far, for every hypothesis, normalised."""
        names = [h.name for h in self.state.hypotheses]
        logs = np.array(
            [
                self._log_prior[n]
                + (self._first_look[n] if self._first_look is not None else 0.0)
                + self._reading_log[n]
                for n in names
            ]
        )
        finite = np.isfinite(logs)
        if not finite.any():
            return  # nothing can be said; keep the beliefs as they were
        weights = np.where(finite, np.exp(logs - logs[finite].max()), 0.0)
        weights = weights / weights.sum()
        for h, w in zip(self.state.hypotheses, weights, strict=True):
            h.posterior = float(w)

    def _relabel(self) -> None:
        """Mark hypotheses as rejected, or back in contention, after an update."""
        for h in self.state.hypotheses:
            out = h.posterior < REJECT_BELOW
            if out and not h.rejected:
                self.state.transcript.append(
                    f"Rejected {h.label}: belief fell below {REJECT_BELOW:.0%}."
                )
            elif h.rejected and not out:
                self.state.transcript.append(
                    f"{h.label.capitalize()} is back in contention at {_pct(h.posterior)}."
                )
            h.rejected = out

    @property
    def fit(self) -> dict[str, float] | None:
        """Log-likelihood of the first capture under each hypothesis, relative to the best."""
        if self._first_look is None:
            return None
        best = max(self._first_look.values())
        return {n: v - best for n, v in self._first_look.items()}

    @property
    def experiments_run(self) -> bool:
        return self._first_look is not None

    # -------------------------------------------------------- virtual experiments
    def _score_first_look(self) -> int:
        """Score the capture under every hypothesis, on the lines they predict."""
        obs = self.observation
        fs, fr = obs.sample_rate_hz, shaft_hz(self.rpm)
        lines = self._lines()
        observed = measure_lines(obs.waveform, fs, fr, lines)
        predictions = self._predictions(lines)
        self._first_look = {n: log_likelihood(observed, p) for n, p in predictions.items()}
        return len(lines)

    def _record_fit(self, h: Hypothesis) -> None:
        relative = self.fit[h.name]
        ev = self.ledger.add(
            f"simulated {h.label}: fit to the capture, relative to the best",
            round(relative, 2),
            " nats",
            "virtual_experiment",
        )
        self._fit_ids[h.name] = ev.id
        (h.supports if relative > -1.0 else h.tensions).append(ev.id)

    def run_virtual_experiments(self, duration_s: float | None = None) -> dict[str, float]:
        """Simulate every hypothesis many times and score the capture against each.

        Returns each hypothesis' log-likelihood relative to the best (0 for the
        best). The first capture is scored once; it is re-scored only when a new
        suspect joins, so that everyone is measured on the same lines.
        """
        if self._first_look is not None:
            return dict(self.fit)

        obs = self.observation
        self._noise = noise_level(obs.waveform, obs.sample_rate_hz, shaft_hz(self.rpm))
        self.ledger.add("broadband noise of the capture", round(self._noise, 3), "", "sensor")
        n_lines = self._score_first_look()

        # The correlation stays as the picture of the comparison (the UI draws
        # the same simulation); the likelihood above is what moves the belief.
        dur = duration_s or min(2.0, obs.duration_s)
        for h in self.state.hypotheses:
            sim = synthesize(
                self._signature_builder(h)(None),
                obs.sample_rate_hz,
                dur,
                seed=self.seed + PICTURE_SEED_OFFSET,
            )
            h.correlation = spectral_correlation(obs.waveform, sim, obs.sample_rate_hz)
            self._record_fit(h)

        self._recompute()
        sims = sum(len(self._severities(h)) for h in self.state.hypotheses) * SEEDS_PER_SEVERITY
        ranked = ", ".join(f"{h.label} {_pct(h.posterior)}" for h in self.state.ranked()[:3])
        self.state.transcript.append(
            f"Virtual experiments: {sims} simulated captures across {n_lines} predicted "
            f"lines. Belief: {ranked}."
        )
        self._relabel()
        return dict(self.fit)

    # ------------------------------------------------------------ written suspects
    def add_hypothesis(self, suspect: OrderSuspect) -> tuple[bool, str]:
        """Add a suspect written during the case, and test it at once.

        It is simulated like the catalogue's hypotheses and scored on everything
        already seen: the first capture (re-scored for everyone on the lines it
        adds) and every reading taken (it predicts none of the catalogue's
        features, so each counts flat for it). Refused, and not added, when it
        predicts nothing that sets it apart from an existing hypothesis.
        Returns (accepted, what happened).
        """
        if self.state.outcome != "open":
            return False, f"The case is already {self.state.outcome}."
        if any(h.name == suspect.name for h in self.state.hypotheses):
            return False, f"'{suspect.name}' is already a hypothesis."

        prior = float(np.mean([h.prior for h in self.state.hypotheses]))
        h = Hypothesis(
            kind=None,
            prior=prior,
            posterior=0.0,
            name=suspect.name,
            origin="written",
            description=suspect.description,
        )
        self._written[suspect.name] = suspect
        self.state.hypotheses.append(h)

        if self._noise is None:
            # The experiments have not run yet; it will be scored with everyone.
            self._log_prior[h.name] = math.log(prior)
            self._reading_log[h.name] = 0.0
            self._recompute()
            self.state.transcript.append(
                f"New suspect {h.label}: waiting for the virtual experiments."
            )
            return True, "Added; it will be simulated with the rest."

        lines = self._lines()
        predictions = self._predictions(lines)
        twin = self._indistinct(h.name, predictions)
        if twin is not None:
            self.state.hypotheses.remove(h)
            del self._written[suspect.name]
            return False, (
                f"It predicts nothing that sets it apart from {twin.replace('_', ' ')}: on every "
                f"line they differ by less than {DISTINCT_SIGMA:g} sigma, so no capture could "
                "tell them apart."
            )

        self._log_prior[h.name] = math.log(prior)
        self._reading_log[h.name] = 0.0
        for test, value, _ in self._readings:
            reading = _Reading(
                test, tuple(self._prediction_for(test, x) for x in self.state.hypotheses)
            )
            self._reading_log[h.name] += float(reading.log_densities(value)[-1])
        obs = self.observation
        observed = measure_lines(obs.waveform, obs.sample_rate_hz, shaft_hz(self.rpm), lines)
        self._first_look = {n: log_likelihood(observed, p) for n, p in predictions.items()}
        self._unexplained.clear()

        sim = synthesize(
            self._signature_builder(h)(None),
            obs.sample_rate_hz,
            min(2.0, obs.duration_s),
            seed=self.seed + PICTURE_SEED_OFFSET,
        )
        h.correlation = spectral_correlation(obs.waveform, sim, obs.sample_rate_hz)
        self._record_fit(h)
        self._recompute()
        self.state.transcript.append(
            f"New suspect {h.label} simulated against the capture and every reading: "
            f"belief {_pct(h.posterior)}; leader {self.state.leader().label} at "
            f"{_pct(self.state.leader().posterior)}."
        )
        self._relabel()
        return True, f"Tested: belief {_pct(h.posterior)}."

    def _indistinct(self, name: str, predictions: dict[str, Prediction]) -> str | None:
        """The existing hypothesis this one cannot be told apart from, if any.

        The new suspect at its written strength is compared with every other
        hypothesis at every severity it is simulated at, so a suspect that is
        only an existing fault at a different strength is caught too.
        """
        new = predictions[name]
        unit = SEVERITY_GRID.index(1.0) if len(new.means) > 1 else 0
        mu_new, sd_new = new.means[unit], new.scales[unit]
        for other, pred in predictions.items():
            if other == name:
                continue
            for mu, sd in zip(pred.means, pred.scales, strict=True):
                gap = np.abs(mu_new - mu) / np.sqrt(sd_new**2 + sd**2)
                gap = gap[np.isfinite(gap)]  # lines this capture cannot show say nothing
                if gap.size == 0 or float(gap.max()) < DISTINCT_SIGMA:
                    return other
        return None

    @staticmethod
    def _prediction_for(test: EvidenceTest, h: Hypothesis) -> float | None:
        return test.predict(h.kind) if h.kind is not None else None

    # ----------------------------------------------------------- choose a test
    def choose_next_test(self) -> TestChoice | None:
        """Expected information gain per technician-minute.

        For each test, imagine its outcome under every live hypothesis (three
        Gauss-Hermite points around its prediction, or the flat range for a
        hypothesis that predicts nothing), work out the posterior each outcome
        would produce, and average the entropy left. Every live hypothesis takes
        part; none is dropped for lacking a prediction.
        """
        live = self.state.surviving(REJECT_BELOW)
        if len(live) < 2:
            return None
        p = np.array([h.posterior for h in live], dtype=float)
        p = p / p.sum()
        h_before = _entropy(p)

        best: TestChoice | None = None
        for test in CATALOG:
            if test.id in self.state.requested_tests:
                continue
            reading = _Reading(test, tuple(self._prediction_for(test, h) for h in live))
            known = [v for v in reading.predictions if v is not None]
            if not known:
                continue
            lo, hi = reading.span

            expected_h = 0.0
            for i, pred in enumerate(reading.predictions):
                if pred is None:
                    outcomes = zip(np.linspace(lo, hi, 7), np.full(7, 1.0 / 7), strict=True)
                else:
                    outcomes = zip(pred + _GH_NODES * test.sigma, _GH_WEIGHTS, strict=True)
                for value, weight in outcomes:
                    post = p * reading.densities(float(value))
                    if post.sum() <= 0:
                        continue
                    expected_h += p[i] * weight * _entropy(post / post.sum())

            gain = h_before - expected_h
            per_min = gain / max(test.effort_min, 0.1)
            spread = (max(known) - min(known)) / test.sigma
            reason = (
                f"separates the survivors by {spread:.1f} sigma; "
                f"{test.effort_min:.0f} min, downtime: {test.downtime}"
            )
            choice = TestChoice(test, gain, per_min, reason)
            if best is None or per_min > best.gain_per_minute:
                best = choice

        if best:
            top = [h.label for h in sorted(live, key=lambda h: h.posterior, reverse=True)[:3]]
            self.state.transcript.append(
                f"Cannot separate {' vs '.join(top)}. Requesting: {best.test.name} ({best.reason})."
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
        hyps = self.state.hypotheses
        reading = _Reading(test, tuple(self._prediction_for(test, h) for h in hyps))
        if all(v is None for v in reading.predictions):
            raise ValueError(f"no hypothesis predicts {test.feature}")
        densities = reading.densities(float(value))

        ev = self.ledger.add(
            f"{test.name}: {test.feature}",
            round(float(value), 3),
            "",
            "human_measurement" if collected_by == "technician" else "sensor",
        )
        top = densities.max()
        for h, pred, d in zip(hyps, reading.predictions, densities, strict=True):
            if pred is not None:
                (h.supports if d >= 0.5 * top else h.tensions).append(ev.id)

        outcome = TestOutcome(test_id=test_id, feature=test.feature, value=value)
        self.state.outcomes.append(outcome)
        self._readings.append((test, float(value), ev.id))

        nearest = min(
            (abs(value - p) / test.sigma for p in reading.predictions if p is not None),
            default=math.inf,
        )
        if nearest > FITS_NONE_SIGMA:
            note = (
                f"{test.feature} = {value:.2f} fits none of the hypotheses: the nearest "
                f"prediction is {nearest:.1f} sigma away."
            )
            self._misfits.append(note)
            self.ledger.add(note, round(nearest, 1), " sigma", "physics")

        for h, log_d in zip(hyps, reading.log_densities(float(value)), strict=True):
            self._reading_log[h.name] += float(log_d)
        self._recompute()
        leader = self.state.leader()
        self.state.transcript.append(
            f"Measured {test.feature} = {value:.2f}. "
            f"Leader is now {leader.label} at {_pct(leader.posterior)}."
        )
        # Rejections are reported after the reading that caused them.
        self._relabel()

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
        return float(table[test.feature])

    # ------------------------------------------------------------------ verdict
    def unexplained(self, name: str | None = None) -> Unexplained | None:
        """The strongest periodic impact in the capture that hypothesis `name`
        (default: the leader) does not predict, if it clears the false-alarm
        threshold."""
        h = self.hypothesis(name) if name else self.state.leader()
        if h.name not in self._unexplained:
            fr = shaft_hz(self.rpm)
            explained = predicted_lines(self._signature_builder(h)(None), fr)
            gap = unexplained_envelope_line(
                self.observation.waveform, self.observation.sample_rate_hz, fr, explained
            )
            self._unexplained[h.name] = gap
            if gap is not None:
                self.ledger.add(
                    f"envelope line at {gap.order:.2f}x shaft ({gap.hz:.0f} Hz) that "
                    f"{h.label} does not predict",
                    gap.power_over_median,
                    "x median power",
                    "physics",
                )
        return self._unexplained[h.name]

    def blockers(self) -> list[str]:
        """Why the case cannot conclude yet. Empty when a verdict is supported."""
        if self.state.outcome != "open":
            return [f"The case is already {self.state.outcome}."]
        reasons: list[str] = []
        leader = self.state.leader()
        if leader.posterior < CONCLUDE_ABOVE:
            runner = self.state.ranked()[1]
            reasons.append(
                f"{leader.label} leads at {_pct(leader.posterior)} and {runner.label} follows "
                f"at {_pct(runner.posterior)}; a verdict needs {CONCLUDE_ABOVE:.0%}."
            )
        else:
            # Only a leader that would otherwise win is held to this: a strong
            # periodic impact it cannot account for means the list is missing a cause.
            gap = self.unexplained(leader.name)
            if gap is not None and gap.power_over_median > gap.strongest_explained:
                reasons.append(
                    f"The capture has periodic impacts at {gap.order:.2f}x shaft speed "
                    f"({gap.hz:.0f} Hz, {gap.power_over_median:.0f}x the median) that "
                    f"{leader.label} does not predict, stronger than anything it explains."
                )
        reasons += self._misfits
        return reasons

    def conclude(self) -> Conclusion:
        """Name the cause. Raises `CannotConclude` when the evidence does not support it."""
        problems = self.blockers()
        if problems:
            raise CannotConclude(" ".join(problems))
        leader = self.state.leader()
        runner_up = self.state.ranked()[1]

        change_my_mind = "Nothing in the current catalogue would move this materially."
        best_gap = 0.0
        for test in CATALOG:
            a, b = self._prediction_for(test, leader), self._prediction_for(test, runner_up)
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

        if leader.kind is not None:
            action = ACTIONS[leader.kind]
        else:
            action = (
                f"Not a cause in the catalogue: {leader.description} Inspect and confirm it "
                "before any repair; no standard action is defined for it."
            )
        conclusion = Conclusion(
            root_cause=leader.kind,
            confidence=leader.posterior,
            reasoning=self._reasoning(leader),
            recommended_action=action,
            what_would_change_my_mind=change_my_mind,
            evidence_ids=self.ledger.ids(),
            cause=leader.name,
        )
        self.state.conclusion = conclusion
        self.state.outcome = "concluded"
        self.state.ledger = self.ledger.items
        self.state.transcript.append(
            f"Conclusion: {leader.label} at {_pct(leader.posterior)}. {action}"
        )
        return conclusion

    def _reasoning(self, leader: Hypothesis) -> str:
        """Say why, from the ledger, without claiming more than it shows."""
        parts: list[str] = []
        fit = self.fit
        if fit:
            best_fit = max(fit, key=fit.get)
            if best_fit == leader.name:
                parts.append(
                    f"{leader.label} explained the measured lines best of every hypothesis "
                    f"simulated ({self._fit_ids[leader.name]})"
                )
            else:
                parts.append(
                    f"{best_fit.replace('_', ' ')} explained the first capture best "
                    f"({self._fit_ids[best_fit]}), but the measurements that followed "
                    f"favoured {leader.label}"
                )
        if self._readings:
            readings = ", ".join(f"{t.feature} = {v:.2f} ({eid})" for t, v, eid in self._readings)
            parts.append(f"measured: {readings}")
        if not parts:
            return f"{leader.label} leads on the evidence in the ledger."
        text = "; ".join(parts)
        return text[0].upper() + text[1:] + "."

    def declare_unresolved(self, reason: str) -> None:
        """Close the case without naming a cause, and say why."""
        if self.state.outcome != "open":
            raise CannotConclude(f"The case is already {self.state.outcome}.")
        self.state.outcome = "unresolved"
        self.state.unresolved_reason = reason
        self.state.ledger = self.ledger.items
        self.state.transcript.append(f"Unresolved: {reason}")

    def finish(self, why_stopped: str) -> None:
        """Conclude if the evidence supports it; otherwise close as unresolved."""
        problems = self.blockers()
        if not problems:
            self.conclude()
        else:
            self.declare_unresolved(" ".join([*problems, why_stopped]).strip())

    # --------------------------------------------------------------------- run
    def advance(self) -> TestChoice | None:
        """After new evidence, take the next step: conclude, close as unresolved,
        or request a measurement. Returns the requested test, or None when the
        case has closed."""
        if self.state.outcome != "open":
            return None
        if not self.blockers():
            self.conclude()
            return None
        if self.state.leader().posterior >= CONCLUDE_ABOVE:
            self.finish("No measurement on the menu addresses what is unexplained.")
            return None
        choice = self.choose_next_test()
        if choice is None:
            self.finish("No measurement on the menu separates them.")
            return None
        self.request(choice)
        return choice

    def run(self, max_requests: int = 2, oracle=None) -> InvestigationState:
        """Drive the whole loop.

        `oracle` supplies requested measurements: a callable (test_id) -> value
        or None. In the demo it is the rig; in production it is a coached
        technician, and without one the case stops open, waiting for the reading.
        """
        self.observe()
        self.run_virtual_experiments()

        for _ in range(max_requests):
            choice = self.advance()
            if choice is None:
                break
            if oracle is None:
                break
            value = oracle(choice.test.id)
            if value is None:
                self.finish(f"Nobody could take the requested reading ({choice.test.name}).")
                break
            self.apply_outcome(choice.test.id, value)
        else:
            if self.state.outcome == "open":
                self.finish(f"The budget of {max_requests} measurements is spent.")

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
