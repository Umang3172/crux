// A work order from a forecast on a recorded run has no repair to check: the
// recording is a replay of something that already happened.

import { Button } from "../../ui/Button";
import { Field } from "../../ui/Tag";
import { laterOf, patchOrder } from "./model";
import type { StageProps } from "./types";
import s from "./stage.module.css";

export function RepairRecorded({ wo, go, source }: StageProps & { source: string }) {
  function next() {
    patchOrder(wo.id, (o) => ({ ...o, stage: laterOf(o.stage, "found") }));
    go("found");
  }
  return (
    <div className={s.main}>
      <Field label="Nothing to repair here" wide>
        <p className={s.lead}>A recorded run can't be repaired.</p>
        <p className={s.sentence}>
          This work order comes from a forecast on {source}. A replay can't be opened up and fixed, so Crux has no repair to check afterwards. You can still say what was found
          and see the lesson Crux keeps from it.
        </p>
      </Field>
      <div className={s.actions}>
        <Button kind="primary" size="l" onClick={next}>
          Go to what was found
        </Button>
      </div>
    </div>
  );
}
