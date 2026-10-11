// Where a case stands, in one line a person can read at arm's length. The
// words are built from the engine's own fields (the named cause and its
// belief, or its reason); nothing here decides anything.

import type { Investigation, TestId } from "../../../api/types";
import { openRequest } from "../../../demo/instrument";
import { pct, signed } from "../../../lib/format";
import { check, fault, plainSentence } from "../../../lib/plain";
import s from "./caseLine.module.css";

/** A reading as the person would say it: the temperature is a rise, the rest are plain ratios. */
export function readingText(test: TestId, value: number): string {
  return test === "temperature" ? `${signed(value, 2)} °C above baseline` : signed(value, 2);
}

export function CaseLine({ inv }: { inv: Investigation }) {
  const c = inv.conclusion;
  if (inv.outcome === "concluded" && c) {
    const healthy = c.root_cause === "healthy";
    return (
      <p className={s.line}>
        {healthy ? (
          <>
            Crux finds <strong>nothing wrong</strong>, at {pct(c.confidence)}.
          </>
        ) : (
          <>
            Crux names <strong>{fault(c.root_cause).name}</strong> at {pct(c.confidence)}.
          </>
        )}
      </p>
    );
  }
  if (inv.outcome === "unresolved") {
    return (
      <div className={s.stack}>
        <p className={s.line}>
          <strong>Crux won't name a cause yet.</strong>
        </p>
        {inv.unresolved_reason && <p className={s.reason}>{plainSentence(inv.unresolved_reason)}</p>}
      </div>
    );
  }
  const next = openRequest(inv);
  if (next) {
    return (
      <p className={s.line}>
        <strong>Crux needs another check:</strong> {check(next.test_id).short}.
      </p>
    );
  }
  return <p className={s.line}>Crux is working on it.</p>;
}
