"""The investigation loop.

    observe -> virtual experiments -> ask for evidence -> conclude, or say "unresolved"

Every step is deterministic and testable. A language model can narrate, re-order
or extend this loop (see `tools/` and `agents/`), but it is never the thing that
decides: beliefs move only here, from simulated likelihoods and measured evidence.

Three rules hold everywhere below:

* Beliefs are one distribution over every hypothesis, recomputed from each
  hypothesis' prior and the log-likelihood of all the evidence so far. Nothing
  is frozen out, so a hypothesis written off early can come back.
* A fault has one severity, whatever it is. The evidence is kept per severity
  and averaged at the end, so a hypothesis cannot explain the first capture as
  a mild fault and a later reading as a severe one.
* What a requested capture will read is simulated for every hypothesis, at the
  capture's own length and noise, never typed in.
* A suspect written during the case is simulated like any other and scored on
  everything already seen, the first capture and every reading. It gains belief
  only by explaining the evidence better.
* There is no verdict below `CONCLUDE_ABOVE`, none while the capture holds a
  strong periodic impact the leader (or the whole list) cannot explain, and none
  after a reading that fits no hypothesis. Such a case ends "unresolved", with
  the reason.
"""

from __future__ import annotations

import math
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import cached_property

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
    capture_features,
    evidence_lines,
    log_likelihood_by_severity,
    logmeanexp,
    measure_lines,
    noise_level,
    predict,
    predict_reading,
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

#: Two hypotheses that differ by less than this many standard deviations cannot
#: be told apart. A written suspect must differ from every existing hypothesis by
#: at least this much on some predicted line, or it is refused as a duplicate; a
#: test is offered only if the two leaders are expected to read this far apart.
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


def _blocks(gap: Unexplained | None) -> bool:
    """An unexplained line stands in the way of a verdict only when it is
    stronger than everything the same hypotheses do explain."""
    return gap is not None and gap.power_over_median > gap.strongest_explained


def _logsumexp(values: np.ndarray) -> float:
    best = float(np.max(values))
    if not math.isfinite(best):
        return best
    return best + math.log(float(np.sum(np.exp(values - best))))


@dataclass(frozen=True)
class _ReadingModel:
    """What each hypothesis predicts one measurement reads, per severity.

    A hypothesis with no prediction for the feature gets a flat density across
    the span the others cover, padded by four sigma: it neither claims the
    value nor rules it out, and pays for being vague.
    """

    test: EvidenceTest
    means: tuple[np.ndarray | None, ...]
    scales: tuple[np.ndarray | None, ...]

    @property
    def known(self) -> bool:
        return any(m is not None for m in self.means)

    @cached_property
    def span(self) -> tuple[float, float]:
        pairs = [(m, s) for m, s in zip(self.means, self.scales, strict=True) if m is not None]
        return (
            min(float((m - 4.0 * s).min()) for m, s in pairs),
            max(float((m + 4.0 * s).max()) for m, s in pairs),
        )

    def log_densities(self, value: float) -> list[np.ndarray]:
        """log p(value | hypothesis, severity): one array per hypothesis."""
        # In logs, so a reading far from a prediction costs a large finite
        # amount instead of underflowing to an impossible zero.
        lo, hi = self.span
        flat = np.array([-math.log(hi - lo)])
        return [
            flat
            if m is None
            else -0.5 * ((value - m) / s) ** 2 - np.log(s * math.sqrt(2.0 * math.pi))
            for m, s in zip(self.means, self.scales, strict=True)
        ]

    def marginal(self, value: float, weights: list[np.ndarray]) -> np.ndarray:
        """log p(value | hypothesis), each averaged over its severities by `weights`."""
        return np.array(
            [
                _logsumexp(np.log(np.maximum(w, 1e-300)) + d)
                for w, d in zip(weights, self.log_densities(value), strict=True)
            ]
        )

    def nearest(self, value: float) -> float:
        """Sigmas between the value and the closest prediction of any hypothesis."""
        return min(
            float((np.abs(value - m) / s).min())
            for m, s in zip(self.means, self.scales, strict=True)
            if m is not None
        )


def _reported(test: EvidenceTest, kind: FaultKind, severity: float | None) -> float | None:
    """What a fault at `severity` predicts for a value a person reports.

    The catalogue's table gives a full-strength fault. A milder one is taken to
    sit proportionally closer to what a healthy machine reads, so a small reading
    does not count against a small fault. An assumption, stated in docs/DOMAIN.md.
    """
    typed = test.predict(kind)
    rest = test.predict(FaultKind.HEALTHY)
    if typed is None or rest is None or severity is None:
        return typed
    return rest + (typed - rest) * min(severity, 1.0)


def _imagine(model: _ReadingModel, p: np.ndarray, weights: list[np.ndarray]) -> tuple[float, float]:
    """Imagine each live hypothesis answering a test.

    Under a hypothesis that predicts the reading, the answers are three
    Gauss-Hermite points around its prediction at each severity; under one that
    predicts nothing, seven points across the flat range. Returns the entropy
    expected afterwards, and the chance the answer brings some hypothesis to
    the bar.
    """
    lo, hi = model.span
    expected_h, settle = 0.0, 0.0
    for i, (m, s) in enumerate(zip(model.means, model.scales, strict=True)):
        if m is None:
            outcomes = [(float(v), 1.0 / 7.0) for v in np.linspace(lo, hi, 7)]
        else:
            outcomes = [
                (float(m[j] + z * s[j]), float(weights[i][j] * w))
                for j in range(len(m))
                for z, w in zip(_GH_NODES, _GH_WEIGHTS, strict=True)
            ]
        for value, weight in outcomes:
            if weight <= 0.0:
                continue
            marginal = model.marginal(value, weights)
            post = p * np.exp(marginal - marginal.max())
            if post.sum() <= 0:
                continue
            post = post / post.sum()
            expected_h += p[i] * weight * _entropy(post)
            if post.max() >= CONCLUDE_ABOVE:
                settle += p[i] * weight
    return expected_h, settle


@dataclass(frozen=True)
class _Taken:
    """A reading already in the evidence, kept so a late suspect is scored on it too."""

    test: EvidenceTest
    value: float
    evidence_id: str
    n: int | None = None  # samples in the answering capture, if not what the test asks for
    noise: float | None = None  # its noise, if measured


@dataclass
class TestChoice:
    test: EvidenceTest
    expected_info_gain: float
    gain_per_minute: float
    reason: str
    #: What each live hypothesis is expected to read, by name.
    predictions: dict[str, float] = field(default_factory=dict)
    #: The allowance on a reading, in the same units.
    sigma: float = 0.0
    #: The two leading hypotheses the test is bought to tell apart.
    separates: tuple[str, ...] = ()
    #: The chance its answer brings some hypothesis to the bar.
    settle_chance: float = 0.0


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
        # Both are kept per severity (see `_log_evidence`).
        self._first_look: dict[str, np.ndarray] | None = None
        self._reading_log = {
            h.name: np.zeros(len(self._severities(h))) for h in self.state.hypotheses
        }
        self._readings: list[_Taken] = []
        self._written: dict[str, OrderSuspect] = {}
        self._noise: float | None = None
        self._fit_ids: dict[str, str] = {}
        self._misfits: list[str] = []
        self._unexplained: dict[str | None, Unexplained | None] = {}
        #: Why the last `choose_next_test` offered nothing, in words.
        self.no_useful_test = ""
        #: Requested readings nobody could take, by test name.
        self._untaken: list[str] = []

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
        logs = np.array([self._log_prior[n] + logmeanexp(self._log_evidence(n)) for n in names])
        finite = np.isfinite(logs)
        if not finite.any():
            return  # nothing can be said; keep the beliefs as they were
        weights = np.where(finite, np.exp(logs - logs[finite].max()), 0.0)
        weights = weights / weights.sum()
        for h, w in zip(self.state.hypotheses, weights, strict=True):
            h.posterior = float(w)

    def _log_evidence(self, name: str) -> np.ndarray:
        """log p(everything seen so far | hypothesis, severity), per severity."""
        first = self._first_look[name] if self._first_look is not None else 0.0
        return np.atleast_1d(first + self._reading_log[name]).astype(float)

    def _severity_weights(self, h: Hypothesis) -> np.ndarray:
        """How the evidence so far spreads a hypothesis over its severities."""
        logs = self._log_evidence(h.name)
        finite = np.isfinite(logs)
        if not finite.any():
            return np.full(len(logs), 1.0 / len(logs))
        weights = np.where(finite, np.exp(logs - logs[finite].max()), 0.0)
        return weights / weights.sum()

    def _capture_noise(self) -> float:
        """The first capture's broadband noise, which every simulation is run at."""
        if self._noise is None:
            obs = self.observation
            self._noise = noise_level(obs.waveform, obs.sample_rate_hz, shaft_hz(self.rpm))
        return self._noise

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
        fits = {n: logmeanexp(v) for n, v in self._first_look.items()}
        best = max(fits.values())
        return {n: v - best for n, v in fits.items()}

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
        self._first_look = {
            n: log_likelihood_by_severity(observed, p) for n, p in predictions.items()
        }
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
        self.ledger.add(
            "broadband noise of the capture", round(self._capture_noise(), 3), "", "sensor"
        )
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
        gap = self.unexplained_by_any()
        if _blocks(gap):
            self.state.transcript.append(
                f"The capture also has periodic impacts at {gap.order:.2f}x shaft speed that "
                "no hypothesis on the list predicts, stronger than anything on the list "
                "explains: the list is missing a cause."
            )
        return dict(self.fit)

    # ------------------------------------------------------------ written suspects
    def add_hypothesis(self, suspect: OrderSuspect) -> tuple[bool, str]:
        """Add a suspect written during the case, and test it at once.

        It is simulated like the catalogue's hypotheses and scored on everything
        already seen: the first capture (re-scored for everyone on the lines it
        adds) and every reading taken (it predicts none of the catalogue's
        features, so each counts flat for it). Refused, and not added, when it
        predicts nothing that sets it apart from an existing hypothesis, or a line
        the capture cannot contain; such a refusal is written to the ledger.
        Returns (accepted, what happened).
        """
        if self.state.outcome != "open":
            return False, f"The case is already {self.state.outcome}."
        if any(h.name == suspect.name for h in self.state.hypotheses):
            return False, f"'{suspect.name}' is already a hypothesis."
        unseen = self._beyond_the_capture(suspect)
        if unseen:
            return self._refuse(suspect, " ".join(unseen))

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

        if not self.experiments_run:
            # The experiments have not run yet; it will be scored with everyone.
            self._log_prior[h.name] = math.log(prior)
            self._replay_readings(h)
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
            return self._refuse(
                suspect,
                f"It predicts nothing that sets it apart from {twin.replace('_', ' ')}: on every "
                f"line they differ by less than {DISTINCT_SIGMA:g} sigma, so no capture could "
                "tell them apart.",
            )

        self._log_prior[h.name] = math.log(prior)
        self._replay_readings(h)
        obs = self.observation
        observed = measure_lines(obs.waveform, obs.sample_rate_hz, shaft_hz(self.rpm), lines)
        self._first_look = {
            n: log_likelihood_by_severity(observed, p) for n, p in predictions.items()
        }
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

    def _beyond_the_capture(self, suspect: OrderSuspect) -> list[str]:
        """Lines of a suspect this capture cannot contain, whatever their cause: a
        component at or above the Nyquist frequency cannot appear in it."""
        fr, nyquist = shaft_hz(self.rpm), self.observation.sample_rate_hz / 2.0
        found = [
            f"A tone at {order:g}x ({order * fr:.0f} Hz) is above {nyquist:.0f} Hz."
            for order, _ in suspect.tones
            if order * fr >= nyquist
        ]
        for rate_order, _, _, resonance_hz in suspect.impacts:
            if rate_order * fr >= nyquist:
                found.append(
                    f"Impacts at {rate_order:g}x ({rate_order * fr:.0f} Hz) are above "
                    f"{nyquist:.0f} Hz."
                )
            if resonance_hz is not None and resonance_hz >= nyquist:
                found.append(f"A resonance at {resonance_hz:.0f} Hz is above {nyquist:.0f} Hz.")
        return found

    def _refuse(self, suspect: OrderSuspect, why: str) -> tuple[bool, str]:
        """A written suspect the physics will not test, with the reason on the record."""
        self.ledger.add(
            f"written suspect {suspect.name.replace('_', ' ')} refused: {why}", source="physics"
        )
        return False, why

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

    def _replay_readings(self, h: Hypothesis) -> None:
        """Score a hypothesis that has just joined on every reading already taken."""
        total = np.zeros(len(self._severities(h)))
        position = self.state.hypotheses.index(h)
        for taken in self._readings:
            model = self._reading_model(taken.test, self.state.hypotheses, taken.n, taken.noise)
            total = total + model.log_densities(taken.value)[position]
        self._reading_log[h.name] = total

    # ------------------------------------------------------ what a test would read
    def _reading_prediction(
        self, test: EvidenceTest, h: Hypothesis, n: int | None = None, noise: float | None = None
    ) -> tuple[np.ndarray, np.ndarray] | None:
        """What `h` predicts `test` reads, per severity: the value and its scale.

        A value a person reports comes from the catalogue's table, the same at
        every severity. A capture is simulated: `n` samples at `noise`, by
        default the length the test asks for at the first capture's noise. None
        when the hypothesis says nothing about the feature, or this sensor
        cannot give it.
        """
        severities = self._severities(h)
        if test.capture_s is None:
            if h.kind is None:
                return None
            means = [_reported(test, h.kind, severity) for severity in severities]
            if means[0] is None:
                return None
            return np.array(means, dtype=float), np.full(len(severities), test.sigma)
        fs = self.observation.sample_rate_hz
        found = predict_reading(
            self._signature_builder(h),
            severities,
            test.feature,
            fs,
            n or round(test.capture_s * fs),
            self._capture_noise() if noise is None else noise,
            self.machine,
            self.rpm,
        )
        if found is None:
            return None
        means, spreads = found
        return means, np.sqrt(spreads**2 + test.sigma**2)

    def _reading_model(
        self,
        test: EvidenceTest,
        hypotheses: list[Hypothesis],
        n: int | None = None,
        noise: float | None = None,
    ) -> _ReadingModel:
        found = [self._reading_prediction(test, h, n, noise) for h in hypotheses]
        return _ReadingModel(
            test,
            tuple(None if f is None else f[0] for f in found),
            tuple(None if f is None else f[1] for f in found),
        )

    def _expected_reading(self, test: EvidenceTest, h: Hypothesis) -> float | None:
        """What `h` would most plausibly read for `test`: its prediction at the
        one severity the evidence favours."""
        severity = self._severities(h)[int(np.argmax(self._severity_weights(h)))]
        if test.capture_s is None:
            return None if h.kind is None else _reported(test, h.kind, severity)
        fs = self.observation.sample_rate_hz
        found = predict_reading(
            self._signature_builder(h),
            [severity],
            test.feature,
            fs,
            round(test.capture_s * fs),
            self._capture_noise(),
            self.machine,
            self.rpm,
        )
        return None if found is None else float(found[0][0])

    # ----------------------------------------------------------- choose a test
    def choose_next_test(self) -> TestChoice | None:
        """Expected information gain per technician-minute, among the tests whose
        answer could settle the case.

        Every live hypothesis is imagined taking each test, at each severity the
        evidence still allows (`_imagine`). The entropy the answers would leave
        gives the test's information gain; the share of answers that would bring
        some hypothesis to the bar is its chance of settling the case. A test is
        not offered, however cheap, when no answer would settle the case or when
        the two leading hypotheses are expected to read within `DISTINCT_SIGMA`
        of each other. When nothing is offered, `no_useful_test` says why.
        """
        self.no_useful_test = ""
        live = self.state.surviving(REJECT_BELOW)
        if len(live) < 2:
            return None
        p = np.array([h.posterior for h in live], dtype=float)
        p = p / p.sum()
        weights = [self._severity_weights(h) for h in live]
        h_before = _entropy(p)
        first, second = sorted(live, key=lambda h: h.posterior, reverse=True)[:2]

        best: TestChoice | None = None
        cannot_settle: TestChoice | None = None
        for test in CATALOG:
            if test.id in self.state.requested_tests:
                continue
            model = self._reading_model(test, live)
            if not model.known:
                continue
            expected_h, settle = _imagine(model, p, weights)
            gain = h_before - expected_h
            per_min = gain / max(test.effort_min, 0.1)
            expected = {
                h.name: float(w @ m)
                for h, w, m in zip(live, weights, model.means, strict=True)
                if m is not None
            }
            apart: float | None = None
            if first.name in expected and second.name in expected:
                apart = abs(expected[first.name] - expected[second.name]) / test.sigma
                told = f"{first.label} and {second.label} expected {apart:.1f} sigma apart"
            else:
                told = f"{first.label} or {second.label} predicts nothing for it"
            reason = (
                f"{told}; {settle:.0%} chance of settling the case; "
                f"{test.effort_min:.0f} min, downtime: {test.downtime}"
            )
            choice = TestChoice(
                test, gain, per_min, reason, expected, test.sigma, (first.name, second.name), settle
            )
            # Not worth a technician's time: no answer would settle the case, or
            # the two leaders are expected to read within a sigma of each other.
            if settle <= 0.0 or (apart is not None and apart < DISTINCT_SIGMA):
                if cannot_settle is None or gain > cannot_settle.expected_info_gain:
                    cannot_settle = choice
            elif best is None or per_min > best.gain_per_minute:
                best = choice

        if best is None:
            if cannot_settle is None:
                self.no_useful_test = "No measurement on the menu separates them."
            elif cannot_settle.settle_chance <= 0.0:
                self.no_useful_test = (
                    "No measurement on the menu can settle it: no answer to the most "
                    f"informative one, {cannot_settle.test.name}, would bring any hypothesis "
                    f"to {CONCLUDE_ABOVE:.0%}."
                )
            else:
                self.no_useful_test = (
                    "No measurement on the menu can settle it: the most informative one, "
                    f"{cannot_settle.test.name}, is expected to read less than "
                    f"{DISTINCT_SIGMA:g} sigma apart for {first.label} and {second.label}."
                )
            return None
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
        # Why this test, in numbers, for whoever draws the request.
        self.state.extra["request"] = {
            "test_id": choice.test.id,
            "expected_readings": {k: round(v, 3) for k, v in choice.predictions.items()},
            "sigma": choice.sigma,
            "separates": list(choice.separates),
            "chance_of_settling": round(choice.settle_chance, 3),
            "expected_info_gain": round(choice.expected_info_gain, 4),
            "gain_per_minute": round(choice.gain_per_minute, 4),
        }

    # ------------------------------------------------------ incorporate evidence
    def apply_outcome(self, test_id: str, value: float, collected_by: str = "technician") -> None:
        """Take in a reading as a number. For a test answered by a capture, the
        capture is assumed to be as long as the test asks for, at the first
        capture's noise; hand over the capture itself (`apply_capture`) when it
        is not."""
        self._apply_reading(BY_ID[test_id], float(value), collected_by)

    def apply_capture(
        self, test_id: str, observation: Observation, collected_by: str = "sensor"
    ) -> float:
        """Take in a requested capture: read the test's feature from it, and score
        that against every hypothesis simulated at this capture's own length and
        noise. Returns the value read."""
        test = BY_ID[test_id]
        if observation.sample_rate_hz != self.observation.sample_rate_hz:
            raise ValueError(
                f"the capture is sampled at {observation.sample_rate_hz:.0f} Hz, the case at "
                f"{self.observation.sample_rate_hz:.0f} Hz"
            )
        value = self.measure_from_capture(test_id, observation)
        noise = noise_level(observation.waveform, observation.sample_rate_hz, shaft_hz(self.rpm))
        self._apply_reading(test, value, collected_by, len(observation.waveform), noise)
        return value

    def _apply_reading(
        self,
        test: EvidenceTest,
        value: float,
        collected_by: str,
        n: int | None = None,
        noise: float | None = None,
    ) -> None:
        hyps = self.state.hypotheses
        model = self._reading_model(test, hyps, n, noise)
        if not model.known:
            raise ValueError(f"no hypothesis predicts {test.feature}")
        by_severity = model.log_densities(value)
        # How well each hypothesis expected this value, given what the evidence
        # so far says of its severity.
        expected = model.marginal(value, [self._severity_weights(h) for h in hyps])

        ev = self.ledger.add(
            f"{test.name}: {test.feature}",
            round(value, 3),
            "",
            "human_measurement" if collected_by == "technician" else "sensor",
        )
        within = float(expected.max()) + math.log(0.5)
        for h, mean, log_d in zip(hyps, model.means, expected, strict=True):
            if mean is not None:
                (h.supports if log_d >= within else h.tensions).append(ev.id)

        self.state.outcomes.append(TestOutcome(test_id=test.id, feature=test.feature, value=value))
        self._readings.append(_Taken(test, value, ev.id, n, noise))

        nearest = model.nearest(value)
        if nearest > FITS_NONE_SIGMA:
            note = (
                f"{test.feature} = {value:.2f} fits none of the hypotheses: the nearest "
                f"prediction is {nearest:.1f} sigma away."
            )
            self._misfits.append(note)
            self.ledger.add(note, round(nearest, 1), " sigma", "physics")

        for h, log_d in zip(hyps, by_severity, strict=True):
            self._reading_log[h.name] = self._reading_log[h.name] + log_d
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
        test = BY_ID[test_id]
        if test.capture_s is None:
            raise ValueError(f"{test.feature} cannot be read from a capture; a person reports it")
        found = capture_features(
            observation.waveform, observation.sample_rate_hz, observation.rpm, self.machine
        )
        if test.feature not in found:
            raise ValueError(
                f"{test.feature} cannot be read from a capture sampled at "
                f"{observation.sample_rate_hz:.0f} Hz"
            )
        return found[test.feature]

    # ------------------------------------------------------------------ verdict
    def _gap(self, key: str | None, statement: str, explained: set[Line]) -> Unexplained | None:
        """The strongest periodic impact in the capture that `explained` leaves
        out, cached under `key` (None for the whole list) and written to the
        ledger the first time it is found."""
        if key not in self._unexplained:
            gap = unexplained_envelope_line(
                self.observation.waveform,
                self.observation.sample_rate_hz,
                shaft_hz(self.rpm),
                explained,
            )
            self._unexplained[key] = gap
            if gap is not None:
                note = f"envelope line at {gap.order:.2f}x shaft ({gap.hz:.0f} Hz) that {statement}"
                if all(e.statement != note for e in self.ledger.items):
                    self.ledger.add(note, gap.power_over_median, "x median power", "physics")
        return self._unexplained[key]

    def unexplained(self, name: str | None = None) -> Unexplained | None:
        """The strongest periodic impact in the capture that hypothesis `name`
        (default: the leader) does not predict, if it clears the false-alarm
        threshold."""
        h = self.hypothesis(name) if name else self.state.leader()
        explained = predicted_lines(self._signature_builder(h)(None), shaft_hz(self.rpm))
        return self._gap(h.name, f"{h.label} does not predict", explained)

    def unexplained_by_any(self) -> Unexplained | None:
        """The strongest periodic impact that no hypothesis on the list predicts."""
        fr = shaft_hz(self.rpm)
        explained: set[Line] = set()
        for h in self.state.hypotheses:
            explained |= predicted_lines(self._signature_builder(h)(None), fr)
        return self._gap(None, "no hypothesis predicts", explained)

    def blocking_gap(self) -> tuple[Unexplained, Hypothesis | None] | None:
        """A periodic impact that stands between the case and a verdict, and the
        hypothesis that leaves it out (None when every hypothesis does).

        Either kind blocks only when it is stronger than everything the same
        hypotheses explain, so a weaker stray line on a real machine does not.
        A line the leader leaves out matters once the leader has reached the
        bar. A line the whole list leaves out matters at any belief: it would
        block whichever of these hypotheses came to lead, so no reading can
        bring a verdict, and the list is missing a cause.
        """
        if not self.experiments_run:
            return None
        gap = self.unexplained_by_any()
        if _blocks(gap):
            return gap, None
        leader = self.state.leader()
        if leader.posterior >= CONCLUDE_ABOVE:
            gap = self.unexplained(leader.name)
            if _blocks(gap):
                return gap, leader
        return None

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
        blocking = self.blocking_gap()
        if blocking is not None:
            gap, h = blocking
            where = (
                f"{gap.order:.2f}x shaft speed ({gap.hz:.0f} Hz, "
                f"{gap.power_over_median:.0f}x the median)"
            )
            reasons.append(
                f"The capture has periodic impacts at {where} that no hypothesis on the list "
                "predicts, stronger than anything on the list explains."
                if h is None
                else f"The capture has periodic impacts at {where} that {h.label} does not "
                "predict, stronger than anything it explains."
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
            a, b = self._expected_reading(test, leader), self._expected_reading(test, runner_up)
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

        reasoning = self._reasoning(leader)
        if leader.kind is FaultKind.HEALTHY:
            unseen = self.cannot_exclude()
            if unseen:
                reasoning += (
                    " A mild fault would look the same in this evidence: "
                    + ", ".join(f"{h.label} at severity {severity:g}" for h, severity in unseen)
                    + " cannot be excluded."
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
            reasoning=reasoning,
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

    def cannot_exclude(self) -> list[tuple[Hypothesis, float]]:
        """The detection limit of a healthy verdict: the faults the evidence fits
        nearly as well as a healthy machine, each at the mildest severity
        simulated.

        "Nearly as well" is the rejection threshold applied one against one: a
        fault is listed if, set alone against healthy with equal priors, it
        would keep at least `REJECT_BELOW` of the belief.
        """
        healthy = next((h for h in self.state.hypotheses if h.kind is FaultKind.HEALTHY), None)
        if healthy is None:
            return []
        reference = float(self._log_evidence(healthy.name).max())
        keep = math.log(REJECT_BELOW / (1.0 - REJECT_BELOW))
        found = []
        for h in self.state.hypotheses:
            severity = self._severities(h)[0]
            if severity is not None and float(self._log_evidence(h.name)[0]) - reference >= keep:
                found.append((h, severity))
        return found

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
            readings = ", ".join(
                f"{r.test.feature} = {r.value:.2f} ({r.evidence_id})" for r in self._readings
            )
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
            return
        untaken = [f"Nobody could take the requested reading ({name})." for name in self._untaken]
        self.declare_unresolved(" ".join([*problems, *untaken, why_stopped]).strip())

    def could_not_take(self, test_id: str, why: str = "") -> None:
        """Record that a requested reading cannot be had. It is not asked for
        again, and the next most useful test can be."""
        name = BY_ID[test_id].name
        self._untaken.append(name)
        self.ledger.add(f"requested measurement could not be taken: {name}", source="physics")
        self.state.transcript.append(
            f"Nobody could take the requested reading ({name})" + (f": {why}." if why else ".")
        )

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
        if self.state.leader().posterior >= CONCLUDE_ABOVE or self.blocking_gap() is not None:
            self.finish("No measurement on the menu addresses what is unexplained.")
            return None
        choice = self.choose_next_test()
        if choice is None:
            self.finish(self.no_useful_test or "No measurement on the menu separates them.")
            return None
        self.request(choice)
        return choice

    def run(self, max_requests: int = 2, oracle=None) -> InvestigationState:
        """Drive the whole loop.

        `oracle` supplies requested measurements: a callable (test_id) -> a
        value, a capture, or None. In the demo it is the rig; in production it
        is a coached technician, and without one the case stops open, waiting
        for the reading.
        """
        self.observe()
        self.run_virtual_experiments()

        taken = 0
        while taken < max_requests:
            choice = self.advance()
            if choice is None:
                break
            if oracle is None:
                break
            answer = oracle(choice.test.id)
            if answer is None:
                # It costs no technician time, so it does not count against the
                # budget; the next most useful test is asked for instead.
                self.could_not_take(choice.test.id)
                continue
            if isinstance(answer, Observation):
                self.apply_capture(choice.test.id, answer)
            else:
                self.apply_outcome(choice.test.id, answer)
            taken += 1
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
