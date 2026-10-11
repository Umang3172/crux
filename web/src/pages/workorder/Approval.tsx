// A person approves the plan by typing their name. There is no login, no reject
// and no edit: Crux only recommends, and nothing here sends a command anywhere.

import { useId, useState } from "react";
import { clock } from "../../lib/format";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Tag";
import f from "./inputs.module.css";
import s from "./stage.module.css";

export function Approval({
  approvedBy,
  approvedAt,
  onApprove,
  onNext,
  nextLabel,
  safety,
  locked,
}: {
  approvedBy?: string;
  approvedAt?: number;
  onApprove: (name: string) => Promise<void> | void;
  onNext: () => void;
  nextLabel: string;
  safety: string;
  /** Why approving is not offered here, when it is not. */
  locked?: string;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const by = name.trim();
    if (!by || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onApprove(by);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The approval was not saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Field label="Approval" wide>
      <div className={f.form}>
        <p className={s.quiet}>{safety}</p>
        {approvedBy ? (
          <>
            <p className={s.lead} aria-live="polite">
              Approved by {approvedBy}
              {approvedAt ? ` at ${clock(approvedAt)}` : ""}.
            </p>
            <div>
              <Button kind="primary" size="l" onClick={onNext}>
                {nextLabel}
              </Button>
            </div>
          </>
        ) : locked ? (
          <p className={s.quiet}>{locked}</p>
        ) : (
          <form className={f.form} onSubmit={submit}>
            <div className={f.field}>
              <label className={f.label} htmlFor={id}>
                Your name
              </label>
              <input id={id} className={f.input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </div>
            <div>
              <Button type="submit" kind="primary" size="l" busy={busy} disabled={!name.trim() || busy}>
                Approve
              </Button>
            </div>
            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
          </form>
        )}
      </div>
    </Field>
  );
}
