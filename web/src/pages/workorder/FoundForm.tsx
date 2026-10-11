// What a person found when the machine was opened, and whether Crux was right.
// The same form serves the work order page and the phone page.

import { useId, useState } from "react";
import { Button } from "../../ui/Button";
import f from "./inputs.module.css";
import s from "./stage.module.css";

export type FoundValues = { text: string; right: boolean; major: boolean; by: string };

export function FoundForm({
  initialName = "",
  majorNote,
  busy,
  error,
  onSubmit,
}: {
  initialName?: string;
  /** Why "warn other sites" is not offered, when it is not. */
  majorNote?: string;
  busy: boolean;
  error: string | null;
  onSubmit: (v: FoundValues) => void;
}) {
  const uid = useId();
  const [text, setText] = useState("");
  const [right, setRight] = useState<boolean | null>(null);
  const [major, setMajor] = useState(false);
  const [by, setBy] = useState(initialName);
  const ready = text.trim() !== "" && right !== null && by.trim() !== "";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || right === null || busy) return;
    onSubmit({ text: text.trim(), right, major: majorNote ? false : major, by: by.trim() });
  }

  return (
    <form className={f.form} onSubmit={submit}>
      <div className={f.field}>
        <label className={f.label} htmlFor={`${uid}-found`}>
          What was found
        </label>
        <textarea
          id={`${uid}-found`}
          className={f.area}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="For example: spalling on the inner ring of the drive-end bearing"
          required
        />
      </div>
      <fieldset className={f.choices}>
        <legend className={f.label}>Was Crux right?</legend>
        <label className={f.choice}>
          <input type="radio" name={`${uid}-right`} checked={right === true} onChange={() => setRight(true)} />
          <span>Crux was right</span>
        </label>
        <label className={f.choice}>
          <input type="radio" name={`${uid}-right`} checked={right === false} onChange={() => setRight(false)} />
          <span>Crux was wrong</span>
        </label>
      </fieldset>
      <label className={f.check} aria-disabled={majorNote ? true : undefined}>
        <input type="checkbox" checked={major} disabled={!!majorNote} onChange={(e) => setMajor(e.target.checked)} aria-describedby={majorNote ? `${uid}-major` : undefined} />
        <span>
          Major failure: warn other sites now
          {majorNote && (
            <span id={`${uid}-major`} className={f.note}>
              {majorNote}
            </span>
          )}
        </span>
      </label>
      <div className={f.field}>
        <label className={f.label} htmlFor={`${uid}-by`}>
          Your name
        </label>
        <input id={`${uid}-by`} className={f.input} value={by} onChange={(e) => setBy(e.target.value)} autoComplete="name" required />
      </div>
      <div className={f.submitRow}>
        <Button type="submit" kind="primary" size="l" busy={busy} disabled={!ready || busy}>
          {busy ? "Saving…" : "Save what was found"}
        </Button>
        {!ready && <span className={f.hint}>Say what was found, whether Crux was right, and your name.</span>}
      </div>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
