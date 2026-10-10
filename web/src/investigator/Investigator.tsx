/**
 * The investigator: a language model working a case through the tools.
 *
 * The other tabs show the engine deciding by itself. This one shows what a
 * model adds, and what it is not allowed to do. Each step is one tool call, set
 * out as two voices: what the model asked for, and what the physics answered.
 * The model writes sentences and, when the list is missing a cause, a suspect
 * as frequencies. The physics tests that suspect like any other. No tool takes
 * a probability from the model, so it never sets a belief.
 *
 * Every sentence in the trace comes from the server (`agents/trace.py`), written
 * from a tool result. With no Gemini credentials on the server an offline
 * stand-in follows the same instruction with the same tools, and the page says
 * so.
 */

import { useCallback, useEffect, useState } from "react";
import { faultText, plainSentence } from "../guided/plain";
import { CaseReportPanel } from "../report/Report";
import { About, AgentRun, RunParams, Suspect, about, investigate } from "./api";
import "./investigator.css";

type Scenario = { id: string; label: string; hint: string; params: Omit<RunParams, "seed"> };

/** Cases chosen to show the three ways a run can go. Seeds vary; these do not. */
const SCENARIOS: Scenario[] = [
  {
    id: "rolling_element",
    label: "A fault that is not on Crux's list",
    hint: "A worn rolling element. No suspect on the list predicts it, so one has to be written.",
    params: { fault: "rolling_element", severity: 1.0, extra_noise: 0.45 },
  },
  {
    id: "inner_race",
    label: "A faint bearing fault on a noisy floor",
    hint: "The first reading is not enough. The investigator has to ask for a check.",
    params: { fault: "inner_race", severity: 0.5, extra_noise: 0.45 },
  },
  {
    id: "unlisted_impact",
    label: "Something no bearing part explains",
    hint: "An impact 7.6 times a turn that matches nothing in this bearing.",
    params: { fault: "unlisted_impact", severity: 1.0, extra_noise: 0.45 },
  },
  {
    id: "healthy",
    label: "A healthy pump",
    hint: "Nothing is wrong. Does the model invent a fault?",
    params: { fault: "healthy", severity: 1.0, extra_noise: 0.05 },
  },
];

/** Belief as the engine words it: never "100%", which nothing measured can be. */
const pct = (x: number) => (x >= 0.995 ? ">99%" : `${Math.round(x * 100)}%`);

const OFF_LIST: Record<string, string> = {
  rolling_element: "a worn rolling element, which is not on Crux's list",
  unlisted_impact: "an impact 7.6 times a turn that no part of this bearing explains",
};

function nameOf(key: string, suspects: Suspect[]): string {
  const known = suspects.find((s) => s.name === key);
  if (known?.origin === "written") return known.label.replace(/^./, (c) => c.toUpperCase());
  return faultText(key).name;
}

function ModelBadge({ run }: { run: AgentRun }) {
  if (run.live) {
    return <p className="i-model live">Run by {run.model}.</p>;
  }
  return (
    <p className="i-model">
      {run.fallback
        ? `${run.fallback} The offline stand-in took the case over, with the same tools and the same instruction.`
        : "Run by the offline stand-in: this server has no Gemini credentials. It follows the instruction Gemini is given, with the same tools, as a fixed policy."}
    </p>
  );
}

function Outcome({ run }: { run: AgentRun }) {
  const c = run.case;
  if (!c) return null;
  const ranked = [...c.suspects]
    .filter((s) => s.belief !== null)
    .sort((a, b) => (b.belief ?? 0) - (a.belief ?? 0))
    .slice(0, 5);
  const fed = OFF_LIST[run.ground_truth] ?? faultText(run.ground_truth).name.toLowerCase();
  const leader = nameOf(c.leader, c.suspects);
  const written = c.suspects.filter((s) => s.origin === "written");
  return (
    <section className="i-outcome" aria-label="Outcome">
      {c.status === "concluded" ? (
        <div className={`g-verdict${c.leader === "healthy" ? " ok" : ""}`}>
          <span>Verdict, from the physics</span>
          <b>{leader}</b>
          <small>{pct(c.leader_belief)} belief, above the {pct(c.conclude_at)} it needs</small>
        </div>
      ) : (
        <div className="g-verdict i-open">
          <span>{c.status === "unresolved" ? "No verdict" : "Waiting for a reading"}</span>
          <b>{c.status === "unresolved" ? "Unresolved" : "Open"}</b>
          <small>
            Leading suspect: {leader}, {pct(c.leader_belief)}
          </small>
        </div>
      )}
      {c.unresolved_reason && <p>{plainSentence(c.unresolved_reason)}</p>}
      {c.investigator_reason && (
        <p className="g-muted">
          The investigator's own reason, in its words: "{c.investigator_reason}" The reason above
          is the physics' and is the one on record.
        </p>
      )}
      {run.stopped && <p className="g-muted">{run.stopped}</p>}
      {c.status === "concluded" && (
        <CaseReportPanel
          id={c.case_id}
          parts={["why", "plain", "limit", "action", "change"]}
          plain={plainSentence}
        />
      )}
      <ul className="i-ranked">
        {ranked.map((s) => (
          <li key={s.name} className={s.status === "rejected" ? "out" : ""}>
            <span>
              {nameOf(s.name, c.suspects)}
              {s.origin === "written" && <em> written by the model, tested by the physics</em>}
            </span>
            <span className="i-bar">
              <span style={{ width: `${Math.round((s.belief ?? 0) * 100)}%` }} />
            </span>
            <span>{pct(s.belief ?? 0)}</span>
          </li>
        ))}
      </ul>
      {written.some((s) => s.status === "refused") && (
        <p className="g-muted">
          The physics refused {written.filter((s) => s.status === "refused").length} written
          suspect(s): see the steps above for why.
        </p>
      )}
      <div className="g-reveal">
        The fault fed in was <b>{fed}</b>. The investigator was never told.
      </div>
    </section>
  );
}

export function Investigator() {
  const [info, setInfo] = useState<About | null>(null);
  const [scenario, setScenario] = useState(SCENARIOS[0].id);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [ran, setRan] = useState<string | null>(null);

  useEffect(() => {
    about()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  const start = useCallback(async () => {
    const chosen = SCENARIOS.find((s) => s.id === scenario) ?? SCENARIOS[0];
    setLoading(true);
    setError(null);
    setRun(null);
    try {
      const seed = 1 + Math.floor(Math.random() * 9999);
      setRun(await investigate({ ...chosen.params, seed }));
      setRan(chosen.label);
    } catch (e) {
      setError(
        `The investigator could not run (${e instanceof Error ? e.message : String(e)}).`,
      );
    } finally {
      setLoading(false);
    }
  }, [scenario]);

  const limits = info?.limits;
  const gemini = info ? info.models.investigator?.startsWith("gemini") : false;

  return (
    <main className="i-shell">
      <header className="m-hero">
        <span className="m-kicker">The investigator</span>
        <h1>The model asks. The physics answers.</h1>
        <p className="m-lede">
          A language model works the case, but only through tools. It can read the evidence, ask
          the physics what to measure, and write a new suspect when the list is missing one. It
          cannot set a belief: the physics simulates whatever it writes and decides.
        </p>
      </header>

      <div className="i-grid">
        <aside className="i-side">
          <section className="i-card">
            <h2>Pick a case</h2>
            <div className="i-options" role="radiogroup" aria-label="Case">
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  role="radio"
                  aria-checked={scenario === s.id}
                  className={`g-option${scenario === s.id ? " on" : ""}`}
                  onClick={() => setScenario(s.id)}
                  disabled={loading}
                >
                  <b>{s.label}</b>
                  <span>{s.hint}</span>
                </button>
              ))}
            </div>
            <button className="g-primary" onClick={() => void start()} disabled={loading}>
              {loading ? "Investigating…" : "Run the investigator"}
            </button>
            <p className="g-muted">
              {info === null
                ? "Reading what is installed on this server…"
                : gemini
                  ? `This server runs ${info.models.investigator}.`
                  : "This server has no Gemini credentials, so an offline stand-in runs the same loop."}
            </p>
          </section>

          {info && (
            <section className="i-card">
              <h2>Everything the model can do</h2>
              <p className="g-muted">
                {info.tools.length} tools. None takes a probability, a score or a reading from the
                model.
                {limits?.rounds !== undefined &&
                  ` A run is stopped after ${limits.rounds} rounds, ${limits.model_calls} model calls or ${limits.seconds} seconds, by plain code.`}
              </p>
              <ul className="i-tools">
                {info.tools.map((t) => (
                  <li key={t.name}>
                    <code>{t.name}</code>
                    <span>
                      {t.does}
                      {t.takes.length > 0 && <em> Takes: {t.takes.join(", ")}.</em>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        <section className="i-run" aria-live="polite">
          {error && <p className="error">{error}</p>}
          {!run && !error && (
            <div className="i-empty">
              <h2>{loading ? "Working the case…" : "Nothing run yet"}</h2>
              <p className="g-muted">
                {loading
                  ? "Each step is a tool call. They appear here when the run is done."
                  : "Pick a case and run it. The first one is the interesting one: the fault is not on the list, so the engine alone can only say that something is missing."}
              </p>
            </div>
          )}
          {run && (
            <>
              <div className="i-run-head">
                <h2>{ran}</h2>
                <ModelBadge run={run} />
              </div>
              <div className="i-legend" aria-hidden="true">
                <span className="i-key model">The model</span>
                <span className="i-key physics">The physics</span>
              </div>
              <ol className="i-steps">
                {run.steps.map((s, i) => (
                  <li key={i} className={`i-step ${s.kind}${s.tool === "get_case" ? " read" : ""}`}>
                    <div className="i-voice model">
                      <span className="i-who">
                        {s.kind === "says" ? "Tells the team" : "Asks"}
                        <code>{s.tool}</code>
                      </span>
                      <p>{s.asked}</p>
                    </div>
                    {s.answered && (
                      <div className="i-voice physics">
                        <span className="i-who">Answers</span>
                        <p>{s.answered}</p>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              {run.thoughts.length > 0 && (
                <details className="i-thoughts">
                  <summary>The model's own summary of its reasoning</summary>
                  {run.thoughts.map((t, i) => (
                    <p key={i}>{t}</p>
                  ))}
                </details>
              )}
              <Outcome run={run} />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
