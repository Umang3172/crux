// What investigating the recording at the clock found. It is the engine's own
// verdict on that one reading, labelled as such: it was made here, on request,
// and is not stored as a case.

import type { RecordingVerdict } from "../../api/types";
import { num, pct } from "../../lib/format";
import { fault, plainSentence } from "../../lib/plain";
import { SourceTag } from "../../ui/SourceTag";
import { Field, Fields, Tag } from "../../ui/Tag";
import s from "./InvestigateResult.module.css";

export function InvestigateResult({ verdict, atH, partLabel, synthetic }: { verdict: RecordingVerdict; atH: number; partLabel: string; synthetic: boolean }) {
  const named = verdict.confident;
  const tone = named ? (verdict.leader.kind === "healthy" ? "safety" : "caution") : "stock";
  return (
    <Tag tone={tone} head={named ? "Cause named" : "No cause yet"} aria-live="polite">
      <Fields columns={2}>
        <Field label="Crux says" wide>
          {plainSentence(verdict.statement)}
        </Field>
        <Field label="Leading suspect">
          <span className={s.lead}>{fault(verdict.leader.kind).name}</span> <span className={s.pct}>{pct(verdict.leader.belief)}</span>
        </Field>
        <Field label="Looked at">
          {partLabel}, running hour {num(atH, 2)}
        </Field>
        <Field label="Every suspect" wide>
          <ul className={s.ranked}>
            {verdict.ranked.map((r) => (
              <li key={r.kind}>
                {fault(r.kind).name} <b>{pct(r.belief)}</b>
              </li>
            ))}
          </ul>
        </Field>
        <Field label="Source" wide>
          <SourceTag>{synthetic ? "synthetic life · physics model" : "recorded run"}</SourceTag> <span className={s.reading}>{verdict.reading}</span>
        </Field>
      </Fields>
      <p className={s.honest}>This reading was investigated here, on request. It is not stored as a case.</p>
    </Tag>
  );
}
