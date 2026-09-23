/**
 * The belief distribution across the competing hypotheses.
 *
 * Bars, not a ranked list: the shape of the distribution is the point. A single
 * tall bar means the physics decided; three middling bars are why the agent is
 * about to ask a person for something.
 */

import { Hypothesis } from "../api";

/**
 * Before the first virtual experiment the engine holds a uniform prior over its
 * candidates (`Investigation.__init__`, `priors = 1 / len(candidates)`). The API
 * does not serialise priors, so the first frame states the assumption in words
 * rather than pretending to have read it back.
 */
function beliefOf(h: Hypothesis, prior: boolean, count: number): number {
  return prior ? 1 / count : h.posterior;
}

export function Beliefs({
  hypotheses,
  prior,
  caption,
}: {
  hypotheses: Hypothesis[];
  prior: boolean;
  caption: string;
}) {
  // Fixed order, so a bar never jumps rows between steps and the eye can follow
  // one hypothesis rising while its rivals collapse.
  const rows = [...hypotheses].sort((a, b) => a.kind.localeCompare(b.kind));
  const top = prior ? null : rows.reduce((a, b) => (a.posterior >= b.posterior ? a : b));

  return (
    <section className="panel">
      <header>
        <h2>Belief</h2>
        <span className="note">{caption}</span>
      </header>
      {rows.map((h) => {
        const p = beliefOf(h, prior, rows.length);
        const rejected = !prior && h.rejected;
        const leader = !prior && top?.kind === h.kind && !rejected;
        return (
          <div
            key={h.kind}
            className={`belief-row${leader ? " leader" : ""}${rejected ? " rejected" : ""}`}
          >
            <span className="belief-name">{h.label}</span>
            <span className="belief-track">
              <span className="belief-fill" style={{ width: `${Math.max(p * 100, 0.6)}%` }} />
            </span>
            <span className="belief-num">
              {(p * 100).toFixed(1)}%
              {!prior && h.correlation !== null && (
                <span className="r"> · r {h.correlation.toFixed(2)}</span>
              )}
            </span>
          </div>
        );
      })}
    </section>
  );
}
