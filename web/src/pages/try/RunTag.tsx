// The test run, hung on the pump as a yellow tag: what will be fed in and who
// will investigate. The one primary action of the page lives inside it, so it
// is always in sight beside the choices. A hidden fault is never named here.

import { Button } from "../../ui/Button";
import { Field, Fields, Tag } from "../../ui/Tag";
import { faultLabel, floorLabel, severityLabel, type Setup, type Who } from "./options";
import s from "./RunTag.module.css";

export function RunTag({
  setup,
  who,
  brain,
  busy,
  onBreak,
  className,
}: {
  setup: Setup;
  /** The investigator that will actually run, after off-list faults force the AI. */
  who: Who;
  /** The AI's name as the server reports it: "offline stand-in", "Gemini". */
  brain: string;
  busy: boolean;
  onBreak: () => void;
  className?: string;
}) {
  return (
    <div className={[s.run, className].filter(Boolean).join(" ")}>
      <Tag tone="caution" head="Test run" aria-label="The test run, ready to start">
        <Fields columns={1}>
          <Field label="Fault fed in">{faultLabel(setup.choice)}</Field>
        </Fields>
        <Fields columns={3}>
          <Field label="Strength">{severityLabel(setup.severity)}</Field>
          <Field label="Floor">{floorLabel(setup.floor)}</Field>
          <Field label="Capture">{setup.pinned ? "Same each time" : "New each time"}</Field>
        </Fields>
        <Fields columns={1}>
          <Field label="Investigator">
            {who === "ai" ? `The AI investigator (${brain})` : "Crux's engine, with you answering any check"}
          </Field>
        </Fields>
        <div className={s.actions}>
          <Button kind="primary" size="l" className={s.go} busy={busy} disabled={busy} onClick={onBreak}>
            {busy ? "Running the virtual experiments…" : "Break it"}
          </Button>
          {busy && (
            <p className={s.status} role="status">
              {who === "ai" ? "Offline, an AI run takes a couple of seconds." : "Testing every suspect on a virtual copy of the pump."}
            </p>
          )}
        </div>
      </Tag>
    </div>
  );
}
