/**
 * The guided view: one case, explained so anyone can follow it.
 *
 * Pick what is wrong with the pump (or let Crux face a hidden fault), start it,
 * and walk through the investigation one step at a time: the reading, the
 * suspects tested on virtual copies of the pump, the one check Crux asks a
 * person for, and the answer with the part it blames.
 *
 * Every number on screen is one the API returned (`run.ts` walks the real
 * endpoints). The words around the numbers come from `plain.ts`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Capture, EvidenceTest, Investigation, Spectra, capture, catalogue, spectra } from "../api";
import { Beliefs } from "../components/Beliefs";
import { Ledger } from "../components/Ledger";
import { Phase, Step, investigate } from "../run";
import { LiveTrace } from "./LiveTrace";
import { PumpScene, SceneStatus } from "./PumpScene";
import { BEARING_FAULTS, CardState, SuspectCard } from "./SuspectCard";
import {
  CHECK_TEXT,
  FAULT_IDS,
  FEATURE_TEXT,
  SCENARIOS,
  SEVERITY_LEVELS,
  faultText,
  leader,
  list,
  live,
  pct,
  plainSentence,
  ranked,
} from "./plain";

const STAGES: { phase: Phase; label: string }[] = [
  { phase: "observe", label: "Reading taken" },
  { phase: "experiments", label: "Suspects tested" },
  { phase: "request", label: "One quick check" },
  { phase: "measurement", label: "Check result" },
  { phase: "conclusion", label: "The answer" },
];

const NEXT_LABEL: Record<Phase, string> = {
  observe: "Test every suspect",
  experiments: "What does Crux need?",
  request: "I've done the check",
  measurement: "Continue",
  conclusion: "Run another case",
};

type Case = {
  scenario: string;
  fault: string;
  severity: number;
  reading: Capture;
  steps: Step[];
  spectra: Record<string, Spectra | null>;
};

export function Guided() {
  const [scenario, setScenario] = useState("mystery");
  const [severity, setSeverity] = useState(0.6);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tests, setTests] = useState<EvidenceTest[]>([]);
  const [current, setCurrent] = useState<Case | null>(null);
  const [cursor, setCursor] = useState(0);
  const [revealed, setRevealed] = useState(true);
  const [details, setDetails] = useState(false);

  useEffect(() => {
    catalogue()
      .then(setTests)
      .catch(() => setTests([]));
  }, []);

  const start = useCallback(async () => {
    const fault =
      scenario === "mystery" ? FAULT_IDS[Math.floor(Math.random() * FAULT_IDS.length)] : scenario;
    const params = { fault, severity, seed: 1 + Math.floor(Math.random() * 9999) };
    setLoading(true);
    setError(null);
    setCurrent(null);
    try {
      const [reading, steps] = await Promise.all([capture(params), investigate(params)]);
      const kinds = steps[0]?.inv.hypotheses.map((h) => h.kind) ?? [];
      const drawn = await Promise.all(
        kinds.map((k) => spectra(params, k, BEARING_FAULTS.has(k) ? "envelope" : "raw")),
      );
      setCurrent({
        scenario,
        fault,
        severity,
        reading,
        steps,
        spectra: Object.fromEntries(kinds.map((k, i) => [k, drawn[i]])),
      });
      setCursor(0);
    } catch (e) {
      setError(
        `Crux could not reach its engine (${e instanceof Error ? e.message : String(e)}). Is the API running?`,
      );
    } finally {
      setLoading(false);
    }
  }, [scenario, severity]);

  const step = current?.steps[cursor] ?? null;
  const inv = step?.inv ?? null;

  // Entering the experiments step plays a short "testing" beat before the
  // results appear, so the order of events is visible. Values never change.
  useEffect(() => {
    if (step?.phase !== "experiments") {
      setRevealed(true);
      return;
    }
    setRevealed(false);
    const t = window.setTimeout(() => setRevealed(true), 1400);
    return () => window.clearTimeout(t);
  }, [step?.key, step?.phase]);

  const vibration = current ? current.reading.rms / (current.reading.baseline_rms || 1) : 1;
  const top = inv && step?.phase === "conclusion" ? leader(inv) : null;

  const sceneStatus: SceneStatus = !current
    ? loading
      ? "running"
      : "off"
    : step?.phase === "conclusion"
      ? top?.kind === "healthy"
        ? "healthy"
        : "decided"
      : "investigating";

  const cardState = useCallback(
    (kind: string, i: Investigation): CardState => {
      if (!step || step.prior) return "waiting";
      if (!revealed) return "testing";
      const h = i.hypotheses.find((x) => x.kind === kind);
      if (!h) return "waiting";
      if (h.rejected) return "ruled-out";
      return leader(i).kind === kind ? "leading" : "live";
    },
    [step, revealed],
  );

  const advance = () => {
    if (!current) return;
    if (cursor >= current.steps.length - 1) {
      setCurrent(null);
      return;
    }
    setCursor((c) => c + 1);
  };

  const stageIndex = useMemo(() => STAGES.findIndex((s) => s.phase === step?.phase), [step]);

  return (
    <div className="g-shell">
      <section className="g-hero">
        <div className="g-hero-text">
          <h1>Find out why the cooling pump is shaking</h1>
          <p>
            This chilled-water pump keeps a data hall's servers cool. When it starts vibrating, Crux
            lists every likely cause, tests each one on a virtual copy of the pump, and asks you for
            one quick check only if it still can't tell. Then it tells you what's wrong and what to
            do.
          </p>
        </div>
      </section>

      <div className="g-stage">
        <div className="g-machine-panel">
          <PumpScene
            status={sceneStatus}
            vibration={current ? vibration : 1}
            highlight={top ? faultText(top.kind).part : null}
            highlightLabel={top ? `Crux: ${faultText(top.kind).name}` : undefined}
          />
          <div className="g-readouts">
            <div className="g-readout">
              <span>Vibration</span>
              <b className={vibration > 1.3 ? "warn" : ""}>
                {current ? `${vibration.toFixed(1)}× normal` : "–"}
              </b>
            </div>
            <div className="g-readout">
              <span>Bearing temperature</span>
              <b>
                {current?.reading.temperature_c != null
                  ? `${current.reading.temperature_c.toFixed(1)} °C`
                  : "–"}
              </b>
            </div>
            <div className="g-readout">
              <span>Speed</span>
              <b>{current ? `${current.reading.rpm.toFixed(0)} rpm` : "–"}</b>
            </div>
            <div className="g-readout trace">
              <span>Vibration sensor</span>
              <LiveTrace waveform={current?.reading.waveform ?? []} running={!!current} />
            </div>
          </div>
        </div>

        <div className="g-side">
          {!current && (
            <section className="g-card g-setup">
              <h2>1. What's wrong with the pump?</h2>
              <p className="g-muted">Pick a problem to feed in, or let Crux face a hidden one.</p>
              <div className="g-options">
                {SCENARIOS.map((s) => (
                  <button
                    key={s.id}
                    className={`g-option${scenario === s.id ? " on" : ""}`}
                    aria-pressed={scenario === s.id}
                    onClick={() => setScenario(s.id)}
                    disabled={loading}
                  >
                    <b>{s.label}</b>
                    {s.hint && <span>{s.hint}</span>}
                  </button>
                ))}
              </div>
              <h2>2. How bad is it?</h2>
              <div className="g-segment">
                {SEVERITY_LEVELS.map((l) => (
                  <button
                    key={l.label}
                    aria-pressed={severity === l.value}
                    className={severity === l.value ? "on" : ""}
                    onClick={() => setSeverity(l.value)}
                    disabled={loading || scenario === "healthy"}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <button className="g-primary" onClick={() => void start()} disabled={loading}>
                {loading ? "Taking a reading…" : "Start the pump and investigate"}
              </button>
              {error && <p className="g-error">{error}</p>}
            </section>
          )}

          {current && step && inv && (
            <section className="g-card g-story">
              <ol className="g-progress" aria-label="Investigation progress">
                {STAGES.map((s, i) => (
                  <li
                    key={s.phase}
                    className={i < stageIndex ? "done" : i === stageIndex ? "now" : ""}
                  >
                    {s.label}
                  </li>
                ))}
              </ol>

              <StepText step={step} inv={inv} current={current} tests={tests} vibration={vibration} revealed={revealed} />

              <div className="g-nav">
                <button
                  className="g-secondary"
                  onClick={() => setCursor((c) => Math.max(0, c - 1))}
                  disabled={cursor === 0}
                >
                  Back
                </button>
                <button
                  className={`g-primary${step.phase === "request" ? " ask" : ""}`}
                  onClick={advance}
                  disabled={!revealed}
                >
                  {NEXT_LABEL[step.phase]}
                </button>
              </div>
            </section>
          )}
        </div>
      </div>

      {current && inv && (
        <section className="g-suspects-wrap">
          <header>
            <h2>The suspects</h2>
            <p className="g-muted">
              Each card is one possible cause. Crux runs a virtual copy of the pump with that fault and
              checks how well its vibration matches the real reading.
            </p>
          </header>
          <div className="g-suspects">
            {/* A fixed order: ranking the cards would give the answer away before testing. */}
            {FAULT_IDS.filter((k) => inv.hypotheses.some((x) => x.kind === k)).map((kind) => {
              const h = inv.hypotheses.find((x) => x.kind === kind)!;
              return (
                <SuspectCard
                  key={h.kind}
                  h={h}
                  state={cardState(h.kind, inv)}
                  spectra={current.spectra[h.kind] ?? null}
                />
              );
            })}
          </div>
        </section>
      )}

      {current && step && inv && (
        <section className="g-details">
          <button className="g-secondary" onClick={() => setDetails((d) => !d)} aria-expanded={details}>
            {details ? "Hide the technical details" : "Show the technical details"}
          </button>
          {details && (
            <div className="g-details-grid">
              <Beliefs hypotheses={inv.hypotheses} prior={step.prior} caption="engine posteriors" />
              <Ledger entries={inv.ledger.slice(0, step.ledgerUpTo)} />
            </div>
          )}
        </section>
      )}

      <p className="g-footnote">
        Demo data: the sensor readings come from a physics model of the pump, not from a real
        machine, and the answer to Crux's check is supplied by the same model. Crux never sees which
        fault was fed in.
      </p>
    </div>
  );
}

function StepText({
  step,
  inv,
  current,
  tests,
  vibration,
  revealed,
}: {
  step: Step;
  inv: Investigation;
  current: Case;
  tests: EvidenceTest[];
  vibration: number;
  revealed: boolean;
}) {
  const names = (kinds: string[]) => kinds.map((k) => faultText(k).name);
  const suspects = inv.hypotheses.length;

  if (step.phase === "observe") {
    const t = current.reading.temperature_c;
    return (
      <div className="g-text">
        <h2>The reading is in</h2>
        <p>
          {vibration < 1.15
            ? "The pump's vibration is about what a healthy pump of this type shows."
            : `The pump is vibrating ${vibration.toFixed(1)} times as much as a healthy pump of this type.`}
          {t != null && ` The bearing is at ${t.toFixed(1)} °C.`}
        </p>
        <p>
          Crux starts with {suspects} suspects, from "nothing wrong" to a worn bearing, and treats them
          all as equally likely until it has tested them.
        </p>
      </div>
    );
  }

  if (step.phase === "experiments") {
    if (!revealed) {
      return (
        <div className="g-text">
          <h2>Testing every suspect…</h2>
          <p>Crux is running a virtual copy of the pump for each suspect.</p>
        </div>
      );
    }
    const order = ranked(inv);
    const best = order.slice(0, 2);
    const out = order.filter((h) => h.rejected).map((h) => h.kind);
    return (
      <div className="g-text">
        <h2>Every suspect tested on a virtual pump</h2>
        <p>
          For each suspect, Crux made a virtual copy of the pump run with that fault and compared its
          vibration with the real reading.
        </p>
        <p>
          Closest matches: {best.map((h) => `${faultText(h.kind).name} (${pct(Math.max(0, h.correlation ?? 0))} match)`).join(" and ")}.
          {out.length > 0 && ` Ruled out: ${list(names(out))}.`}
        </p>
        <p className="g-lead">
          Most likely so far: <b>{faultText(order[0].kind).name}</b>, at {pct(order[0].posterior)}.
        </p>
      </div>
    );
  }

  if (step.phase === "request" && step.requestIndex !== null) {
    const testId = inv.requested_tests[step.requestIndex];
    const test = tests.find((t) => t.id === testId);
    const pair = live(inv).slice(0, 2).map((h) => h.kind);
    return (
      <div className="g-text">
        <h2>Crux needs one quick check</h2>
        <p>
          It can't yet tell {list(names(pair))} apart: their virtual copies both fit the reading.
        </p>
        <div className="g-ask">
          <span>Please do this</span>
          <p>{CHECK_TEXT[testId] ?? test?.name ?? testId}</p>
          {test && (
            <small>
              About {test.effort_min.toFixed(0)} minutes ·{" "}
              {test.downtime === "none" ? "the pump keeps running" : "needs a brief stop"}
            </small>
          )}
        </div>
        <p className="g-muted">
          Of every check Crux could ask for, this one tells it the most per minute of your time.
        </p>
      </div>
    );
  }

  if (step.phase === "measurement" && step.requestIndex !== null) {
    const outcome = inv.outcomes[step.requestIndex];
    const now = leader(inv);
    return (
      <div className="g-text">
        <h2>The check came back</h2>
        {outcome && (
          <p>
            {FEATURE_TEXT[outcome.feature]
              ? `The result of ${FEATURE_TEXT[outcome.feature]} was `
              : "The reading was "}
            <b>{outcome.value.toFixed(2)}</b>.
          </p>
        )}
        <p className="g-lead">
          That fits <b>{faultText(now.kind).name}</b>, which is now {pct(now.posterior)} likely.
        </p>
      </div>
    );
  }

  // conclusion
  const top = leader(inv);
  const text = faultText(top.kind);
  const sure = (inv.conclusion?.confidence ?? top.posterior) >= 0.8;
  const mystery = current.scenario === "mystery";
  const right = top.kind === current.fault;
  return (
    <div className="g-text">
      <h2>{sure ? "The answer" : "Crux isn't sure yet"}</h2>
      <div className={`g-verdict${top.kind === "healthy" ? " ok" : ""}`}>
        <span>{sure ? "Cause" : "Best guess"}</span>
        <b>{text.name}</b>
        <small>{pct(inv.conclusion?.confidence ?? top.posterior)} confident</small>
      </div>
      {text.story && <p>{text.story}</p>}
      {top.kind !== "healthy" && (
        <p>
          <b>Where:</b> {text.partName}.
        </p>
      )}
      <p>
        <b>What to do:</b> {text.fix}
      </p>
      {inv.conclusion?.what_would_change_my_mind && (
        <p className="g-muted">
          What would change Crux's mind: {plainSentence(inv.conclusion.what_would_change_my_mind)}
        </p>
      )}
      {mystery && (
        <div className={`g-reveal ${right ? "right" : "wrong"}`}>
          The hidden fault was <b>{faultText(current.fault).name}</b>.{" "}
          {right ? "Crux found it." : "Crux got this one wrong."}
        </div>
      )}
    </div>
  );
}
