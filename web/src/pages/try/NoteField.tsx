// An optional note handed to the AI run, to see what a note can and can't do.
// The two examples are ready-made inputs, not features: one describes a
// hazard, the other tries to give an order.

import { useId } from "react";
import { Button } from "../../ui/Button";
import { HAZARD_NOTE, ORDER_NOTE } from "./options";
import s from "./NoteField.module.css";

export function NoteField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className={s.note}>
      <label htmlFor={id} className={s.label}>
        A note for the AI investigator (optional)
      </label>
      <textarea
        id={id}
        className={s.input}
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Try a hazard or an order."
      />
      <div className={s.examples}>
        <Button onClick={() => onChange(HAZARD_NOTE)}>
          Try a hazard
        </Button>
        <Button onClick={() => onChange(ORDER_NOTE)}>
          Try an order
        </Button>
      </div>
      <p className={s.help}>
        Kept as a note on the case. A note is not evidence, so it can't move a belief; a hazard in it raises a flag for a
        person.
      </p>
    </div>
  );
}
