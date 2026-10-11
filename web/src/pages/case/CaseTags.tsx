// What hangs on the machine: the check Crux asks for, then the answer.

import { useState } from "react";
import type { Investigation } from "../../api/types";
import { encodeKey, openRequest, type InstrumentParams } from "../../demo/instrument";
import type { CaseEntry } from "../../demo/world";
import { pct, signed } from "../../lib/format";
import { check, fault, plainSentence } from "../../lib/plain";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { phoneCheckUrl, QrCode } from "../../ui/QrCode";
import { Field, Fields, Tag } from "../../ui/Tag";
import s from "./Case.module.css";

export function MeasureTag({
  inv,
  entry,
  caseId,
  busy,
  onDoItHere,
  canAnswer,
  error,
}: {
  inv: Investigation;
  entry: CaseEntry | undefined;
  caseId: string;
  busy: boolean;
  onDoItHere: () => void;
  canAnswer: boolean;
  error: string | null;
}) {
  const [phone, setPhone] = useState(false);
  const open = openRequest(inv);
  // The tag shows the latest request: open, or the one just answered.
  const req = open ?? inv.request;
  if (!req) return null;
  const c = check(req.test_id);
  const chosen = req.considered.find((x) => x.fate === "chosen");
  const minutes = chosen?.minutes ?? null;
  const stop = chosen && chosen.downtime !== "none";
  const answer = !open ? [...inv.outcomes].reverse().find((o) => o.test_id === req.test_id) : undefined;
  const by = entry?.answered[req.test_id];
  const url = entry ? phoneCheckUrl(caseId, encodeKey(entry.params as InstrumentParams)) : null;

  return (
    <Tag tone="measure" head="Measure" line drop={!!open} stamp={answer ? "Answered" : undefined} aria-label="The one check Crux asks for">
      <Fields columns={2}>
        <Field label="Check" wide>
          {c.name} at {c.where}
        </Field>
        <Field label="Time">
          <span className={s.bigTime}>{minutes === null ? "–" : `${minutes} min`}</span>
        </Field>
        <Field label="Machine">{stop ? "Needs a brief stop" : "Keeps running"}</Field>
        {chosen && (
          <Field label="Why this one" wide>
            {chosen.why.replace(/^Chosen: /, "").replace(/^./, (x) => x.toUpperCase())}
          </Field>
        )}
        {answer && (
          <Field label="Reading" wide>
            {signed(answer.value)} by the pump model's virtual instrument
            {by ? (by.from === "phone" ? ", taken on the phone" : ", taken here") : ""}
          </Field>
        )}
      </Fields>
      {open && (
        <>
          <div className={s.tagActions}>
            <Button kind="primary" onClick={onDoItHere} disabled={busy || !canAnswer} busy={busy}>
              {busy ? "Taking the reading…" : "Do it here"}
            </Button>
            {url && (
              <Button onClick={() => setPhone((v) => !v)} aria-expanded={phone}>
                <Icon name="phone" /> Do it on a phone
              </Button>
            )}
          </div>
          {phone && url && (
            <div className={s.phone}>
              <QrCode value={url} size={112} label="QR code: open this check on a phone" />
              <div>
                <p>Scan with a phone on the floor. The first answer wins; this page updates by itself.</p>
                <a className={s.phoneLink} href={url}>
                  {url}
                </a>
              </div>
            </div>
          )}
          <p className={s.tagStatus} role="status">
            <Icon name="circle" size={14} /> Waiting for the reading
          </p>
          {!canAnswer && <p className={s.error}>This browser didn't start the case, so it can't take the reading here.</p>}
          {error && <p className={s.error}>{error}</p>}
        </>
      )}
    </Tag>
  );
}

export function VerdictTag({ inv }: { inv: Investigation }) {
  const c = inv.conclusion;
  if (!c) return null;
  const f = fault(c.root_cause);
  const healthy = c.root_cause === "healthy";
  return (
    <Tag tone={healthy ? "safety" : "caution"} head={healthy ? "Normal" : "Inspect"} line drop aria-label="The answer">
      <Fields columns={2}>
        <Field label="Cause" wide>
          {f.name}
        </Field>
        <Field label="Belief">{pct(c.confidence)}</Field>
        <Field label="Where">{healthy ? "Nothing to open" : f.partName}</Field>
        {!healthy && (
          <Field label="Do" wide>
            {plainSentence(c.recommended_action)}
          </Field>
        )}
      </Fields>
    </Tag>
  );
}
