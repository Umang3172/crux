// The answer key. A run the visitor chose to hide the fault of keeps it behind
// a button; any other run never shows it at all.

import type { AgentRun, CaseView } from "../../../api/types";
import { patchCase, type CaseEntry } from "../../../demo/world";
import { fault } from "../../../lib/plain";
import { Button } from "../../../ui/Button";
import { Field, Fields, Tag } from "../../../ui/Tag";
import s from "./Reveal.module.css";

export function Reveal({ entry, run, c }: { entry: CaseEntry | undefined; run: AgentRun; c: CaseView }) {
  if (!entry?.hidden) return null;
  if (!entry.revealed) {
    return (
      <div className={s.ask}>
        <Button onClick={() => patchCase(entry.id, { revealed: true })}>Reveal what was fed in</Button>
        <p className={s.line}>The fault given to this pump was hidden from you. Look at it once you have read the answer.</p>
      </div>
    );
  }
  const named = c.status === "concluded" ? fault(c.leader).name : null;
  return (
    <div className={s.shown}>
      <Tag tone="stock" head="Fed in" aria-label="What was fed in">
        <Fields columns={2}>
          <Field label="The fault given to the pump">{fault(run.ground_truth).name}</Field>
          <Field label="What Crux named">{named ?? "No cause"}</Field>
        </Fields>
      </Tag>
    </div>
  );
}
