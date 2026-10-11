// What happened to the press. Three honest outcomes: sent and the engine has
// re-tested; sent and the answer hasn't landed yet (the page keeps asking);
// or another screen got there first, in which case nothing was sent from here.

import type { Investigation } from "../../../api/types";
import { openRequest } from "../../../demo/instrument";
import { Button } from "../../../ui/Button";
import { CaseLine } from "./caseLine";
import type { Phase } from "./useTakeReading";
import s from "./SentPanel.module.css";

export function SentPanel({
  done,
  inv,
  onNext,
}: {
  done: Extract<Phase, { kind: "done" }>;
  inv: Investigation;
  onNext: () => void;
}) {
  // The server scores a reading inside the same request that carries it, so
  // by the time a press returns the case has usually moved. If it hasn't, the
  // page keeps reading the case until it does.
  const processed = inv.outcomes.length > done.before || inv.outcome !== "open";
  const another = processed && inv.outcome === "open" && openRequest(inv) !== null;

  return (
    <section className={s.panel} aria-live="polite" aria-label="What happened to the reading">
      <h2 className={s.title}>{done.already ? "Already answered from the laptop" : "Sent."}</h2>
      <p className={s.body}>
        {done.already
          ? "Nothing was sent from this phone."
          : processed
            ? "Crux re-tested with your reading. The answer is on the case page."
            : "Crux is re-testing. The answer is on the case page."}
      </p>
      {processed && (
        <div className={s.result}>
          <CaseLine inv={inv} />
        </div>
      )}
      {another && (
        <Button kind="secondary" size="l" className={s.next} onClick={onNext}>
          Show the next check
        </Button>
      )}
    </section>
  );
}
