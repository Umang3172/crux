// The work order is closed: what was found is on record, and a demo-pump order
// hands its machine back to normal on the plant (the plant reads this browser's
// work orders).

import { clock } from "../../lib/format";
import { ButtonLink } from "../../ui/Button";
import { Field } from "../../ui/Tag";
import { LessonResult, type FleetOutcome } from "./LessonResult";
import { choiceTitle, OUTCOME } from "./model";
import type { StageProps } from "./types";
import s from "./stage.module.css";

export function ClosedStage({
  wo,
  machineName,
  lesson,
  writer,
}: Pick<StageProps, "wo"> & {
  machineName: string;
  /** The lesson the server just wrote, while this page still has it. */
  lesson: { result: FleetOutcome; major: boolean } | null;
  writer: string;
}) {
  const found = wo.found;
  return (
    <div className={s.main}>
      <Field label="Closed" wide>
        <h2 className={s.title}>{wo.kind === "case" ? `${machineName} is back to normal on the plant.` : "This work order is closed."}</h2>
        <p className={s.quiet}>
          {wo.kind === "case"
            ? "Saved in this demo: this work order is kept in this browser, and nothing was sent to other sites."
            : "The finding went to the server, which keeps it as a lesson at this site."}
        </p>
      </Field>
      {found && (
        <Field label="What was found" wide>
          <p className={s.lead}>{found.text}</p>
          <p className={s.quiet}>
            {found.right ? "Crux was right." : "Crux was wrong."} Recorded by {found.by} at {clock(found.at)}.
          </p>
        </Field>
      )}
      {wo.repair && (
        <Field label="Repair check" wide>
          <p className={s.sentence}>
            {choiceTitle(wo.repair.choice)}: {OUTCOME[wo.repair.result.outcome].head.toLowerCase()}.
          </p>
        </Field>
      )}
      {lesson && <LessonResult result={lesson.result} major={lesson.major} writer={writer} />}
      <div className={s.actions}>
        <ButtonLink to="/" kind="primary" size="l">
          Back to the plant
        </ButtonLink>
        <ButtonLink to="/work-orders">All work orders</ButtonLink>
      </div>
    </div>
  );
}
