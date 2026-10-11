import type { Investigation } from "../../api/types";
import { fault } from "../../lib/plain";
import { Button } from "../../ui/Button";
import { SuspectRack } from "../../ui/SuspectRack";
import { Notes } from "./Notes";
import s from "./Case.module.css";

export function StageSuspects({
  inv,
  caseId,
  onNoted,
  onNext,
}: {
  inv: Investigation;
  caseId: string;
  onNoted: (inv: Investigation) => void;
  onNext: () => void;
}) {
  // Before any experiment every suspect is equally likely.
  const even = 1 / inv.hypotheses.length;
  const kinds = inv.hypotheses.map((h) => h.kind);
  return (
    <div className={s.stage}>
      <h2 className={s.h2}>{inv.hypotheses.length} suspects, all equally likely</h2>
      <p className={s.lead}>
        Crux starts from every cause that could make a pump vibrate like this, and doesn't favour any of them yet.
      </p>
      <SuspectRack suspects={inv.hypotheses.map((h) => ({ kind: h.kind, label: h.label, origin: h.origin, belief: even, ruledOut: false }))} order={kinds} />
      <dl className={s.stage} style={{ gap: "var(--space-3)" }}>
        {inv.hypotheses.map((h) => {
          const f = fault(h.kind);
          return (
            <div key={h.kind}>
              <dt style={{ fontWeight: 600 }}>
                {f.name} <span className={s.muted}>· {f.partName}</span>
              </dt>
              <dd className={s.muted}>{f.story}</dd>
            </div>
          );
        })}
      </dl>
      <Notes inv={inv} caseId={caseId} onNoted={onNoted} />
      <div className={s.next}>
        <Button kind="primary" size="l" onClick={onNext}>
          Test each one on a virtual copy
        </Button>
      </div>
    </div>
  );
}
