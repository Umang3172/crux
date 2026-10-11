// What Crux kept from a finding: the lesson the server wrote, and where it went.
// Who worded it is shown as configured, because the server does not say whether
// the model answered or a template did.

import type { outcome } from "../../api/crux";
import { Field } from "../../ui/Tag";
import s from "./stage.module.css";

export type FleetOutcome = Awaited<ReturnType<typeof outcome>>;

export function LessonResult({ result, major, writer }: { result: FleetOutcome; major: boolean; writer: string }) {
  const l = result.lesson;
  const sent = major && result.sent_to_hub ? "Sent to the other sites." : result.sent_to_hub ? "Shared with the hub for the next update." : "Kept at this site: there is no hub on this server.";
  return (
    <>
      <Field label="Lesson saved" wide>
        <p className={s.lead} aria-live="polite">
          {l.title}
        </p>
        <p className={s.quiet}>{l.outcome === "success" ? "Crux was right, so this is kept as a call to trust." : "Crux missed, so this is kept as a call to double-check."}</p>
      </Field>
      {l.do && (
        <Field label="Do" wide>
          <p className={s.sentence}>{l.do}</p>
        </Field>
      )}
      {l.avoid && (
        <Field label="Avoid" wide>
          <p className={s.sentence}>{l.avoid}</p>
        </Field>
      )}
      <Field label="Where it went" wide>
        <p className={s.sentence}>{sent}</p>
        <p className={s.quiet}>Worded by the lesson writer, configured as {writer}.</p>
      </Field>
    </>
  );
}
