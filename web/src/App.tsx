/**
 * The investigation view.
 *
 * Built for the thirty seconds a judge spends on the deployed link: the page
 * opens a case by itself, then plays the investigation back one engine state at
 * a time — beliefs moving, the ledger growing, the moment it stops and asks a
 * person for a measurement, the verdict and what would overturn it.
 *
 * Every frame is a state the API returned. Playback controls the order things
 * are revealed in, never their values.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EvidenceTest, catalogue, health } from "./api";
import { Beliefs } from "./components/Beliefs";
import { ConclusionCard } from "./components/Conclusion";
import { Ledger } from "./components/Ledger";
import { RequestCard } from "./components/RequestCard";
import { Spectrum } from "./components/Spectrum";
import { Phase, Step, investigate } from "./run";

const FAULTS = [
  "imbalance",
  "misalignment",
  "looseness",
  "outer_race",
  "inner_race",
  "healthy",
] as const;

const SEVERITIES: { label: string; value: number }[] = [
  { label: "light", value: 0.35 },
  { label: "moderate", value: 0.6 },
  { label: "severe", value: 1.0 },
];

/** How long each beat holds. The request is the story, so it gets the pause. */
const DWELL: Record<Phase, number> = {
  observe: 1500,
  experiments: 2200,
  request: 3200,
  measurement: 1800,
  conclusion: 0,
};

const CAPTIONS: Record<Phase, string> = {
  observe: "uniform prior · nothing tested yet",
  experiments: "after simulating every hypothesis",
  request: "too close to call",
  measurement: "after the measurement came back",
  conclusion: "settled",
};

/** The engineer's view: every engine state, the ledger and the spectra. */
export default function App({ embedded = false }: { embedded?: boolean }) {
  const [models, setModels] = useState<Record<string, string>>({});
  const [online, setOnline] = useState<boolean | null>(null);
  const [tests, setTests] = useState<EvidenceTest[]>([]);

  // Looseness at light severity is the case the physics cannot close on its own,
  // so the opening run is the one that shows the agent stopping to ask a person.
  // A bearing fault at this severity is decided by simulation alone — impressive,
  // but it skips the part that makes this not a classifier.
  const [fault, setFault] = useState<string>("looseness");
  const [severity, setSeverity] = useState(0.35);
  const [seed] = useState(1234);

  const [steps, setSteps] = useState<Step[]>([]);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(() => ({ fault, severity, seed }), [fault, severity, seed]);
  const ranOnce = useRef(false);

  useEffect(() => {
    health()
      .then((h) => {
        setModels(h.models);
        setOnline(true);
      })
      .catch(() => setOnline(false));
    catalogue()
      .then(setTests)
      .catch(() => setTests([]));
  }, []);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setPlaying(false);
    try {
      const played = await investigate(params);
      setSteps(played);
      setCursor(0);
      setPlaying(played.length > 1);
    } catch (e) {
      setSteps([]);
      setError(
        `${e instanceof Error ? e.message : String(e)} — is the API up? Try GET /health.`,
      );
    } finally {
      setBusy(false);
    }
  }, [params]);

  // Open a case on arrival. The deployed link should be telling its story
  // before anyone decides whether to click anything.
  useEffect(() => {
    if (ranOnce.current) return;
    ranOnce.current = true;
    void run();
  }, [run]);

  const step: Step | null = steps[cursor] ?? null;

  useEffect(() => {
    if (!playing || !step) return;
    if (cursor >= steps.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setCursor((c) => c + 1), DWELL[step.phase]);
    return () => window.clearTimeout(timer);
  }, [playing, cursor, step, steps.length]);

  const inv = step?.inv ?? null;
  // While a measurement is outstanding the story is the tie, so draw the two
  // leading live suspects; otherwise the leader alone. Ranked by the engine's
  // own posteriors. Once choose_next_test names the pair it separates, use that.
  const suspects = useMemo<string[]>(() => {
    if (!inv || step?.prior) return [];
    const live = [...inv.hypotheses]
      .filter((h) => !h.rejected)
      .sort((a, b) => b.posterior - a.posterior);
    const ranked = live.length > 0 ? live : [...inv.hypotheses].sort((a, b) => b.posterior - a.posterior);
    const tied = step?.phase === "request" && !step.answered && ranked.length > 1;
    return ranked.slice(0, tied ? 2 : 1).map((h) => h.kind);
  }, [inv, step]);

  return (
    <div className={embedded ? "g-engineer" : "shell"}>
      {!embedded && (
      <header className="topbar">
        <span className="wordmark">Crux</span>
        <span className="tagline">
          MechNova · the one measurement that decides
        </span>
        <span className="models">
          <span className={`dot${online === false ? " down" : ""}`} />
          {online === false
            ? "api unreachable"
            : Object.entries(models)
                .map(([k, v]) => `${k}=${v}`)
                .join("  ") || "…"}
        </span>
      </header>
      )}

      <div className="controls">
        <div className="field">
          <span className="label">Induced fault</span>
          <div className="segmented">
            {FAULTS.map((f) => (
              <button
                key={f}
                aria-pressed={fault === f}
                disabled={busy}
                onClick={() => setFault(f)}
              >
                {f.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Severity</span>
          <div className="segmented">
            {SEVERITIES.map((s) => (
              <button
                key={s.label}
                aria-pressed={severity === s.value}
                disabled={busy}
                onClick={() => setSeverity(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <button className="run" onClick={() => void run()} disabled={busy}>
          {busy ? "investigating…" : "Run an investigation"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {steps.length > 0 && (
        <div className="steps" style={{ paddingBottom: 18 }}>
          {steps.map((s, i) => (
            <button
              key={s.key}
              aria-current={i === cursor}
              className={i < cursor ? "done" : undefined}
              onClick={() => {
                setPlaying(false);
                setCursor(i);
              }}
            >
              {i + 1}. {s.title}
            </button>
          ))}
          <button onClick={() => setPlaying((p) => !p)} disabled={cursor >= steps.length - 1}>
            {playing ? "pause" : "play"}
          </button>
        </div>
      )}

      <div className="grid">
        <div className="col">
          {inv && step && (
            <Beliefs
              hypotheses={inv.hypotheses}
              prior={step.prior}
              caption={CAPTIONS[step.phase]}
            />
          )}

          {inv && step && step.requestIndex !== null && (
            <RequestCard
              inv={inv}
              index={step.requestIndex}
              answered={step.answered}
              tests={tests}
            />
          )}

          {inv?.conclusion && step?.phase === "conclusion" && (
            <ConclusionCard conclusion={inv.conclusion} />
          )}

          {inv && !inv.conclusion && inv.outcome === "unresolved" && step?.phase === "conclusion" && (
            <section className="conclusion">
              <header>
                <h2>Unresolved</h2>
              </header>
              <p className="reason">{inv.unresolved_reason}</p>
            </section>
          )}

          <Spectrum params={params} suspects={suspects} />

          {inv && step && (
            <section className="panel">
              <header>
                <h2>What it is doing</h2>
                <span className="note">
                  {inv.machine.name} · {inv.rpm.toFixed(0)} rpm
                </span>
              </header>
              <div className="transcript">
                {inv.transcript.slice(0, step.transcriptUpTo).map((line, i) => (
                  <div key={line} style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}>
                    <span className="n">{String(i + 1).padStart(2, "0")}</span>
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="col pinned">
          <Ledger entries={inv ? inv.ledger.slice(0, step?.ledgerUpTo ?? 0) : []} />
        </div>
      </div>
    </div>
  );
}
