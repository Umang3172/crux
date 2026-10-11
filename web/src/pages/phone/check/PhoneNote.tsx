// A note from the floor: what someone saw, heard or smelt. It is kept with
// the case and never moves a belief. If the server reads a hazard in it, the
// hazard flag goes up here too, and stays until a person acknowledges it.

import { useState, type FormEvent } from "react";
import { addNote } from "../../../api/crux";
import { machineDef } from "../../../demo/stories";
import { raiseHazard } from "../../../demo/world";
import { plainSentence } from "../../../lib/plain";
import { Button } from "../../../ui/Button";
import { Section } from "../../../ui/Section";
import { Tag } from "../../../ui/Tag";
import { messageOf } from "./useTakeReading";
import s from "./PhoneNote.module.css";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "kept"; hazard: string | null } | { kind: "failed"; message: string };

export function PhoneNote({ caseId, machine }: { caseId: string; machine: string }) {
  const [text, setText] = useState("");
  const [by, setBy] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || !by.trim() || state.kind === "sending") return;
    setState({ kind: "sending" });
    try {
      const inv = await addNote(caseId, text.trim(), by.trim());
      // Only this note decides whether a hazard is shown as new; an older flag has its own banner.
      const added = inv.notes[inv.notes.length - 1];
      const hazard = added && added.hazards.length > 0 ? inv.hazard : null;
      if (hazard) raiseHazard({ caseId, machine, text: hazard });
      setText("");
      setState({ kind: "kept", hazard });
    } catch (err) {
      setState({ kind: "failed", message: messageOf(err) });
    }
  }

  const sending = state.kind === "sending";
  return (
    <Section title="Add a note" id="phone-note">
      <p className={s.help}>
        Anything you saw, heard or smelt. A note is kept with the case. It is not evidence, so it can't move a belief; a
        hazard in it raises a flag for a person.
      </p>
      <form className={s.form} onSubmit={send}>
        <label className={s.field}>
          <span className={s.label}>What did you notice</span>
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} required />
        </label>
        <label className={s.field}>
          <span className={s.label}>Your name</span>
          <input value={by} onChange={(e) => setBy(e.target.value)} autoComplete="name" required />
        </label>
        <Button type="submit" size="l" busy={sending} disabled={sending || !text.trim() || !by.trim()}>
          {sending ? "Adding…" : "Add the note"}
        </Button>
      </form>
      <div aria-live="polite">
        {state.kind === "kept" && !state.hazard && <p className={s.kept}>Kept. Not evidence: nothing in the case moved.</p>}
        {state.kind === "kept" && state.hazard && (
          <Tag tone="danger" head="Hazard reported">
            <div className={s.hazard}>
              <p>{plainSentence(state.hazard)}</p>
              <p className={s.do}>
                {machineDef(machine)?.name ?? "The machine"} stays flagged at the top of this page until a person acknowledges it
                with their name.
              </p>
            </div>
          </Tag>
        )}
        {state.kind === "failed" && (
          <p className={s.failed} role="alert">
            The note was not kept. {state.message}
          </p>
        )}
      </div>
    </Section>
  );
}
