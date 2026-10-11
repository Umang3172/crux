// The buttons under the tag: investigate the reading at the clock, and draft
// the work order. A control that cannot work says why instead of hiding.

import type { WorkOrder } from "../../demo/world";
import { Button, ButtonLink } from "../../ui/Button";
import type { Drafting, Inquiry } from "./useRecordingActions";
import s from "./RecordingActions.module.css";

export function RecordingActions({
  alarmed,
  inquiry,
  drafting,
  existing,
  onInvestigate,
  onDraft,
}: {
  alarmed: boolean;
  inquiry: Inquiry;
  drafting: Drafting;
  /** A work order already drafted for this part. */
  existing: WorkOrder | undefined;
  onInvestigate: () => void;
  onDraft: () => void;
}) {
  const running = inquiry.phase === "running";
  return (
    <div className={s.actions}>
      <div className={s.buttons}>
        <Button kind="primary" size="l" onClick={onInvestigate} disabled={inquiry.phase === "unavailable" || running} busy={running}>
          {running ? "Investigating…" : "Investigate now"}
        </Button>
        {existing ? (
          <ButtonLink to={`/work-order/${existing.id}`} size="l">
            Open work order {existing.id}
          </ButtonLink>
        ) : (
          <Button size="l" onClick={onDraft} disabled={!alarmed || drafting.phase === "running"} busy={drafting.phase === "running"}>
            {drafting.phase === "running" ? "Drafting…" : "Draft the work order"}
          </Button>
        )}
      </div>
      {drafting.phase === "running" && (
        <p className={s.reason} role="status">
          Drafting the work order. If a language model is writing it, this can take a minute.
        </p>
      )}
      {inquiry.phase === "unavailable" && <p className={s.reason}>{inquiry.reason.replace(" (TBD)", "")}</p>}
      {!alarmed && !existing && <p className={s.reason}>No alarm yet, so there is nothing to draft a work order for.</p>}
      {inquiry.phase === "error" && (
        <p className={s.error} role="alert">
          {inquiry.message}
        </p>
      )}
      {drafting.phase === "error" && (
        <p className={s.error} role="alert">
          {drafting.message}
        </p>
      )}
    </div>
  );
}
