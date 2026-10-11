// What did you find, on a phone: the claim Crux made, one form, and what
// happened to the answer. One column, big targets, nothing to read twice.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useHealth, useReducedMotion } from "../../../lib/hooks";
import { brainOf } from "../../../app/ai";
import { SourceTag } from "../../../ui/SourceTag";
import { Field, Fields, Tag, type TagTone } from "../../../ui/Tag";
import { FoundForm, type FoundValues } from "../../workorder/FoundForm";
import { LessonResult, type FleetOutcome } from "../../workorder/LessonResult";
import s from "./Flow.module.css";
import q from "../../workorder/stage.module.css";

export type Subject = {
  /** The machine, as the plant names it. */
  name: string;
  /** Where its numbers come from. */
  source?: string;
  tagHead: string;
  tone: TagTone;
  facts: { label: string; value: ReactNode }[];
  initialName?: string;
  /** Why "warn other sites" is not offered, when it is not. */
  majorNote?: string;
  /** Set when what was found is already on record from here: the form is not offered again. */
  already?: string | null;
};

export function Flow({ subject, save }: { subject: Subject; save: (v: FoundValues) => Promise<FleetOutcome | null> }) {
  const health = useHealth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ lesson: FleetOutcome | null; major: boolean } | null>(null);
  const writer = brainOf(health.data?.models.lesson_writer);
  const reduce = useReducedMotion();
  const saved = useRef<HTMLDivElement>(null);

  // The form shrinks to a receipt; make sure the receipt, not blank ground, is what is in view.
  useEffect(() => {
    if (done) saved.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [done, reduce]);

  async function submit(v: FoundValues) {
    setBusy(true);
    setError(null);
    try {
      setDone({ lesson: await save(v), major: v.major });
    } catch (e) {
      setError(e instanceof Error ? e.message : "What was found was not saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.name}>{subject.name}</h1>
        <p className={s.ask}>{done ? "It's on record" : "What did you find?"}</p>
        {subject.source && (
          <p className={s.meta}>
            <SourceTag>{subject.source}</SourceTag>
          </p>
        )}
      </header>

      <Tag tone={subject.tone} head={subject.tagHead} aria-label="What Crux said">
        <Fields columns={1}>
          {subject.facts.map((f) => (
            <Field key={f.label} label={f.label}>
              {f.value}
            </Field>
          ))}
        </Fields>
      </Tag>

      {done ? (
        <div ref={saved} className={s.saved}>
          <Tag tone="safety" head="Saved" aria-live="polite">
            {done.lesson ? (
              <LessonResult result={done.lesson} major={done.major} writer={writer.live ? writer.name : "the template"} />
            ) : (
              <Field label="Saved in this demo" wide>
                <p className={q.sentence}>This work order is kept in this browser. Nothing was sent to other sites.</p>
              </Field>
            )}
          </Tag>
        </div>
      ) : subject.already ? (
        <p className={s.already} role="status">
          {subject.already}
        </p>
      ) : (
        <section aria-label="What was found">
          <FoundForm initialName={subject.initialName} majorNote={subject.majorNote} busy={busy} error={error} onSubmit={submit} />
        </section>
      )}

      <p className={s.foot}>Recorded runs are replays and the demo pump is a physics model, both labelled. Nothing here sends a command to a machine.</p>
    </div>
  );
}
