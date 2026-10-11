import { clock } from "../../lib/format";
import { Field } from "../../ui/Tag";
import type { HazardOn } from "./hazard";
import s from "./HazardLine.module.css";

/** The one place red appears on a work order: a hazard someone reported. */
export function HazardLine({ hazard, link }: { hazard: HazardOn; link?: React.ReactNode }) {
  return (
    <Field label="Hazard reported" wide className={s.hazard}>
      <div role="alert" className={s.body}>
        <p className={s.text}>{hazard.text}</p>
        {hazard.notes.map((n) => (
          <p key={n.id} className={s.said}>
            {n.by} wrote: “{n.text}”
          </p>
        ))}
        {(hazard.ackable || link) && (
          <p className={s.said}>
            {hazard.ackable && (hazard.ack ? `Acknowledged by ${hazard.ack.by} at ${clock(hazard.ack.at)}. ` : "Not acknowledged yet. ")}
            {link}
          </p>
        )}
      </div>
    </Field>
  );
}
