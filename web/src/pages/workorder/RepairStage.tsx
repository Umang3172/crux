// The repair, on the demo pump. Crux never touches a machine, so the visitor
// stands in for the technician and says what the repair did; the pump model
// then takes a new capture in that state and Crux investigates it from scratch.

import { useState } from "react";
import { repair } from "../../api/crux";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { SourceTag } from "../../ui/SourceTag";
import { ErrorState } from "../../ui/States";
import { Field } from "../../ui/Tag";
import { CHOICES, laterOf, patchOrder, type ChoiceId } from "./model";
import type { StageProps } from "./types";
import c from "./RepairStage.module.css";
import s from "./stage.module.css";

export function RepairStage({ wo, go, cause }: StageProps & { cause: string | null }) {
  const [busy, setBusy] = useState<ChoiceId | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const locked = wo.stage === "closed";
  // Out of line is the thing a repair can leave behind; offering it for a misalignment verdict would make no sense.
  const options = CHOICES.filter((o) => !(o.id === "misaligned" && cause === "misalignment"));

  async function choose(id: ChoiceId) {
    const option = CHOICES.find((o) => o.id === id);
    if (!option || !wo.caseId || busy) return;
    setBusy(id);
    setError(null);
    try {
      const result = await repair(wo.caseId, option.request);
      // The result carries the rig's answer key. Nothing here shows it, so it is not kept either.
      patchOrder(wo.id, (o) => ({
        ...o,
        stage: laterOf(o.stage, "check"),
        repair: { choice: id, at: Date.now(), result: { ...result, rig: null } },
      }));
      go("check");
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={s.main}>
      <Field label="Demo pump: choose what the repair did" wide>
        <p className={s.sentence}>
          Crux never touches a machine. Here you stand in for the technician: say what the repair did, and the pump model takes a new reading of the pump in that state. Crux then
          investigates that reading from scratch.
        </p>
        <p className={s.row}>
          <SourceTag>physics model · synthetic</SourceTag>
          {wo.approvedBy && <span className={s.status}>Approved by {wo.approvedBy}.</span>}
        </p>
      </Field>
      <ul className={c.choices}>
        {options.map((o) => {
          const chosen = wo.repair?.choice === o.id;
          return (
            <li key={o.id}>
              <button type="button" className={c.choice} onClick={() => choose(o.id)} disabled={busy !== null || locked} aria-pressed={chosen}>
                <span className={c.title}>{o.title}</span>
                <span className={c.body}>{o.body}</span>
                <span className={c.act}>
                  {busy === o.id ? (
                    "Taking the new reading…"
                  ) : chosen ? (
                    <>
                      <Icon name="check" size={16} /> Chosen
                    </>
                  ) : (
                    <>
                      Choose this <Icon name="arrow-right" size={16} />
                    </>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className={s.actions} aria-live="polite">
        {busy ? (
          <span className={s.status}>The pump model is taking a new capture and Crux is investigating it. This takes a few seconds.</span>
        ) : wo.repair ? (
          <Button kind="primary" size="l" onClick={() => go("check")}>
            See the check
          </Button>
        ) : (
          <span className={s.status}>Pick one. Nothing is sent to a machine.</span>
        )}
        {locked && wo.repair && <span className={s.status}>This work order is closed, so the repair can't be changed.</span>}
      </div>
      {error && (
        <div className={s.pad}>
          <ErrorState error={error} title="The repair check didn't run" />
        </div>
      )}
    </div>
  );
}
