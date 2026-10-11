// The scorecard, in the order an abstaining system should be judged: how often
// it answered alone, how often it needed a technician's check, how often it
// declined, and only then how often it was wrong.

import { Field, Fields, Tag } from "../../ui/Tag";
import { Accuracy } from "./Accuracy";
import { ASKED, CRUX, TOTAL } from "./figures";
import { Swatch, type TallyKind } from "./Tally";
import s from "./Scorecard.module.css";

function Figure({ kind, n }: { kind: TallyKind; n: number }) {
  return (
    <p className={s.figure}>
      <Swatch kind={kind} />
      <span className={s.n}>{n}</span>
      <span className={s.of}>of {TOTAL}</span>
    </p>
  );
}

export function Scorecard() {
  return (
    <Tag tone="stock" head={`Crux on ${TOTAL} hard synthetic cases`} aria-label={`Crux's scorecard on ${TOTAL} hard synthetic cases`}>
      <Fields columns={3}>
        <Field label="Solved by simulation alone">
          <Figure kind="right" n={CRUX.alone} />
          <p className={s.note}>No check was asked for, and every one named the right cause.</p>
        </Field>
        <Field label="Needed a technician's check">
          <Figure kind="check" n={CRUX.afterCheck} />
          <p className={s.note}>
            {ASKED} cases asked for a check. In these {CRUX.afterCheck} the reading settled it and Crux named the right
            cause.
          </p>
        </Field>
        <Field label="Couldn't answer">
          <Figure kind="void" n={CRUX.cantTell} />
          <p className={s.note}>
            Asked for up to two checks and still said "can't tell". Crux names a cause only at 80% belief with nothing left
            unexplained.
          </p>
        </Field>
      </Fields>
      {/* Wrong answers come last on purpose; the two headings inside say whose they are. */}
      <div className={s.wrongs}>
        <Accuracy />
      </div>
    </Tag>
  );
}
