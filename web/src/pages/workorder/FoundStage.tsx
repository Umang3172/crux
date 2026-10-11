// What was found when the machine was opened. A demo-pump work order keeps the
// answer in this browser and says so. A forecast work order sends it to the
// server, which turns it into a lesson, so a phone can do the same from a link.

import { useState, type ReactNode } from "react";
import { clock } from "../../lib/format";
import { Button } from "../../ui/Button";
import { QrCode } from "../../ui/QrCode";
import { Field } from "../../ui/Tag";
import { FoundForm, type FoundValues } from "./FoundForm";
import type { FleetOutcome } from "./LessonResult";
import { phoneFoundUrl } from "./links";
import { saveFound } from "./saveFound";
import type { StageProps } from "./types";
import c from "./FoundStage.module.css";
import s from "./stage.module.css";

export function FoundStage({
  wo,
  go,
  said,
  onLesson,
}: StageProps & {
  /** What Crux said and what its check showed, so the finding is written beside the claim. */
  said: ReactNode;
  onLesson: (result: FleetOutcome, major: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ticket = wo.kind === "ticket";

  async function save(v: FoundValues) {
    setBusy(true);
    setError(null);
    try {
      if (ticket && !wo.ticketId) throw new Error("This work order has no ticket to report on.");
      const lesson = await saveFound(wo, ticket ? wo.ticketId : undefined, v);
      if (lesson) onLesson(lesson, v.major);
      go("closed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "What was found was not saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.split}>
      <div className={s.main}>
        {wo.found ? (
          <Field label="What was found" wide>
            <p className={s.lead}>{wo.found.text}</p>
            <p className={s.quiet}>
              {wo.found.right ? "Crux was right." : "Crux was wrong."} Recorded by {wo.found.by} at {clock(wo.found.at)}.
            </p>
            <div className={s.row}>
              <Button kind="primary" onClick={() => go("closed")}>
                See the closed work order
              </Button>
            </div>
          </Field>
        ) : (
          <Field label="What was found when the machine was opened" wide>
            <FoundForm
              initialName={wo.approvedBy}
              busy={busy}
              error={error}
              onSubmit={save}
              majorNote={ticket ? undefined : "Warning other sites works on forecast work orders. This one stays in this browser."}
            />
          </Field>
        )}
      </div>
      <div className={s.side}>
        <Field label="What Crux said" wide>
          {said}
        </Field>
        {ticket && wo.ticketId && !wo.found && (
          <Field label="Or record it on a phone" wide>
            <div className={c.phone}>
              <QrCode value={phoneFoundUrl(wo.ticketId)} size={112} label="Scan to record what was found on a phone" />
              <p className={s.quiet}>The ticket is on the server, so any device can reach it. Scan to say what was found from the floor.</p>
            </div>
          </Field>
        )}
      </div>
    </div>
  );
}
