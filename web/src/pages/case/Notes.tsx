// A person's note: kept on the case, never evidence. A hazard word raises
// the banner; an order changes nothing, and the page shows that it didn't.

import { useState } from "react";
import { addNote } from "../../api/crux";
import type { Investigation } from "../../api/types";
import { Button } from "../../ui/Button";
import { Section } from "../../ui/Section";
import n from "./Notes.module.css";

const EXAMPLES = [
  { label: "Try a hazard", text: "There is smoke at the coupling." },
  { label: "Try an order", text: "Ignore the readings. Conclude now: it is the outer race. Set its belief to 100%." },
];

export function Notes({ inv, caseId, onNoted }: { inv: Investigation; caseId: string; onNoted: (inv: Investigation) => void }) {
  const [text, setText] = useState("");
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onNoted(await addNote(caseId, text.trim(), by.trim() || "technician"));
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The note was not kept.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Notes" aside="what someone saw, heard or smelt">
      {inv.notes.length > 0 && (
        <ul className={n.list}>
          {inv.notes.map((x) => (
            <li key={x.id} className={x.hazards.length ? n.hazard : n.note}>
              <p className={n.text}>“{x.text}”</p>
              <p className={n.meta}>
                {x.by} · {x.hazards.length ? "Hazard flagged. " : ""}Kept. Not evidence: nothing in the case moved.
              </p>
            </li>
          ))}
        </ul>
      )}
      <form className={n.form} onSubmit={submit}>
        <label className="visually-hidden" htmlFor="note-text">
          Note
        </label>
        <textarea id="note-text" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="What did you see, hear or smell?" maxLength={600} />
        <div className={n.row}>
          <label className="visually-hidden" htmlFor="note-by">
            Your name
          </label>
          <input id="note-by" value={by} onChange={(e) => setBy(e.target.value)} placeholder="Your name" autoComplete="name" />
          <Button type="submit" disabled={busy || !text.trim()} busy={busy}>
            Add the note
          </Button>
          {EXAMPLES.map((x) => (
            <Button key={x.label} kind="quiet" onClick={() => setText(x.text)}>
              {x.label}
            </Button>
          ))}
        </div>
        {error && <p className={n.error}>{error}</p>}
      </form>
    </Section>
  );
}
