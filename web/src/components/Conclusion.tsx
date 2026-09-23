/**
 * The verdict, and the two things that make it worth reading: the action it
 * implies, and what would overturn it. A diagnosis that cannot name its own
 * weak point is a guess with a percentage attached.
 */

import { Conclusion as Verdict } from "../api";

export function ConclusionCard({ conclusion }: { conclusion: Verdict }) {
  return (
    <section className="conclusion">
      <header>
        <h2>Root cause</h2>
      </header>
      <div className="verdict">
        <span className="cause">{conclusion.root_cause.replace("_", " ")}</span>
        <span className="conf">{(conclusion.confidence * 100).toFixed(0)}% confident</span>
      </div>
      <p className="reason">{conclusion.reasoning}</p>

      <div className="kv">
        <div>
          <div className="k">Recommended action</div>
          <div className="v">{conclusion.recommended_action}</div>
        </div>
        <div>
          <div className="k">What would change my mind</div>
          <div className="v">{conclusion.what_would_change_my_mind}</div>
        </div>
      </div>

      <div className="cites">cites {conclusion.evidence_ids.join(" ")}</div>
    </section>
  );
}
