// The check on a phone, once the case and the catalogue are in hand: one
// column, the check first, the one button within the thumb's reach.

import type { CatalogTest, Investigation } from "../../../api/types";
import { openRequest } from "../../../demo/instrument";
import { machineDef, PLANT_NAME } from "../../../demo/stories";
import { Section } from "../../../ui/Section";
import { SourceTag } from "../../../ui/SourceTag";
import { AnswerDock } from "./AnswerDock";
import { CaseLine } from "./caseLine";
import { CheckTag } from "./CheckTag";
import { PhoneNote } from "./PhoneNote";
import { SentPanel } from "./SentPanel";
import { Steps } from "./Steps";
import type { Phase } from "./useTakeReading";
import { Why } from "./Why";
import { spotFor, WhereDrawing } from "./WhereDrawing";
import s from "./Floor.module.css";

/** The demo pump: the only machine a QR code is made for. */
export const PUMP = "p2";

export function Floor({
  caseId,
  inv,
  tests,
  phase,
  take,
  next,
  offline,
}: {
  caseId: string;
  inv: Investigation;
  tests: CatalogTest[];
  phase: Phase;
  take: () => void;
  next: () => void;
  /** The last read of the case failed; what is on screen may be a few seconds old. */
  offline: boolean;
}) {
  const request = openRequest(inv);
  const done = phase.kind === "done" ? phase : null;
  const test = tests.find((t) => t.id === (done?.test ?? request?.test_id));

  const headline = done
    ? done.already
      ? "Check already answered"
      : "Reading sent"
    : request
      ? inv.outcomes.length === 0
        ? "Crux needs one check"
        : "Crux needs another check"
      : "This case isn't waiting for a reading";

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.name}>{machineDef(PUMP)?.name ?? "Cooling-water pump P-2"}</h1>
        <p className={s.ask}>{headline}</p>
        <p className={s.meta}>
          <SourceTag>physics model · synthetic</SourceTag>
          <span>{PLANT_NAME}</span>
        </p>
      </header>

      {offline && (
        <p className={s.offline} role="status">
          Can't reach the engine just now. Trying again.
        </p>
      )}

      {done && test ? (
        <>
          <CheckTag test={test} answered={{ value: done.value }} />
          <SentPanel done={done} inv={inv} onNext={next} />
        </>
      ) : request && test ? (
        <>
          <CheckTag test={test} />
          <Why separates={request.separates} />
          <Section title="Where to put the sensor" id="where">
            <WhereDrawing spot={spotFor(test.id)} />
          </Section>
          <Section title="What to do" id="steps">
            <Steps steps={test.procedure} />
          </Section>
          <AnswerDock taking={phase.kind === "taking"} error={phase.kind === "failed" ? phase.message : null} onTake={take} />
        </>
      ) : (
        <div className={s.result} aria-live="polite">
          <CaseLine inv={inv} />
        </div>
      )}

      <PhoneNote caseId={caseId} machine={PUMP} />
      <p className={s.foot}>Synthetic data, labelled synthetic. Nothing here sends a command to a machine.</p>
    </div>
  );
}
