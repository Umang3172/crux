import { useState } from "react";
import { useNavigate } from "react-router";
import { report } from "../../api/crux";
import type { Investigation, Report } from "../../api/types";
import { getWorld, nextWorkOrderId, patchCase, upsertWorkOrder, useWorld, type CaseEntry } from "../../demo/world";
import { FLOOR, SEVERITY } from "../../demo/stories";
import { pct } from "../../lib/format";
import { useAsync, useHealth } from "../../lib/hooks";
import { brainOf } from "../../app/ai";
import { CONCLUDE_AT, fault, plainSentence } from "../../lib/plain";
import { Button, ButtonLink } from "../../ui/Button";
import { CountUp } from "../../ui/CountUp";
import { Section } from "../../ui/Section";
import { Field, Fields } from "../../ui/Tag";
import { ledgerById, restsOnTemperatureTable } from "./model";
import { NoCause } from "./StageCheck";
import s from "./Case.module.css";
import a from "./Answer.module.css";

export function StageAnswer({
  inv,
  entry,
  caseId,
  machineName,
  evidence,
}: {
  inv: Investigation;
  entry: CaseEntry | undefined;
  caseId: string;
  machineName: string;
  evidence: boolean;
}) {
  const c = inv.conclusion;
  if (inv.outcome !== "concluded" || !c) return <NoCause inv={inv} considered={inv.no_test?.considered ?? inv.request?.considered ?? []} />;
  const f = fault(c.root_cause);
  const healthy = c.root_cause === "healthy";
  const ledger = ledgerById(inv);
  const change = plainSentence(c.what_would_change_my_mind);
  return (
    <div className={s.stage}>
      <div className={a.verdict}>
        <h2 className={a.cause}>{f.name}</h2>
        <p className={a.technical}>{f.technical && f.technical !== f.name.toLowerCase() ? `${f.technical} · ${f.partName}` : f.partName}</p>
        <div className={a.bar} role="img" aria-label={`Belief ${pct(c.confidence)}; Crux needs ${pct(CONCLUDE_AT)}`}>
          <span className={a.fill} style={{ width: `${Math.min(100, c.confidence * 100)}%` }} />
          <span className={a.bar80} style={{ left: `${CONCLUDE_AT * 100}%` }}>
            {pct(CONCLUDE_AT)} to name a cause
          </span>
        </div>
        <p className={a.belief}>
          <CountUp value={c.confidence} format={pct} /> belief
        </p>
      </div>
      <div className={a.fields}>
        <Fields columns={2}>
          <Field label="Where">{healthy ? "Nothing to open" : f.partName}</Field>
          <Field label="What to do">{plainSentence(c.recommended_action)}</Field>
          <Field label="What would change Crux's mind" wide>
            {change}
            {restsOnTemperatureTable(c.what_would_change_my_mind) && (
              <span className={a.note}> That rests on a temperature table that has not yet been measured on a machine.</span>
            )}
          </Field>
          {c.limit && (
            <Field label="Limit" wide>
              {plainSentence(c.limit)}
            </Field>
          )}
          {c.caveat && (
            <Field label="Caveat" wide>
              {plainSentence(c.caveat)}
            </Field>
          )}
          {healthy && c.cannot_exclude.length > 0 && (
            <Field label="Can't rule out" wide>
              Mild {c.cannot_exclude.map((x) => fault(x.kind).name.toLowerCase()).join(", ")}.
            </Field>
          )}
        </Fields>
      </div>
      <Section title="Why" aside="the engine's own words">
        <p>{withoutIds(plainSentence(c.reasoning))}</p>
        {evidence && (
        <p className={a.chips}>
          {citedIn(c.reasoning, c.evidence_ids).map((id) => {
            const e = ledger.get(id);
            return (
              <span key={id} className={a.cite} title={id}>
                {e ? `${plainSentence(e.statement)}: ${String(e.value)} ${e.unit}`.trim() : id}
              </span>
            );
          })}
        </p>
        )}
      </Section>
      <Explanation caseId={caseId} />
      {inv.history.length > 0 && (
        <Section title="Earlier on this pump" aside="never changes the odds">
          <ul className={a.history}>
            {inv.history.map((h) => (
              <li key={h.case_id}>{plainSentence(h.sentence)}</li>
            ))}
          </ul>
        </Section>
      )}
      <WhatNext inv={inv} entry={entry} caseId={caseId} machineName={machineName} />
    </div>
  );
}

/** Evidence ids belong in the log; a sentence reads better without them. */
const withoutIds = (t: string) => t.replace(/\s*\(E\d{2,}(?:, ?E\d{2,})*\)/g, "");

/** The entries the reasoning names, or the last few it rests on; the full list is in the evidence log. */
function citedIn(text: string, ids: string[]): string[] {
  const named = [...text.matchAll(/\b(E\d{2,})\b/g)].map((m) => m[1]).filter((id) => ids.includes(id));
  return named.length ? [...new Set(named)] : ids.slice(-3);
}

function Explanation({ caseId }: { caseId: string }) {
  const r = useAsync(() => report(caseId), [caseId]);
  const writer = brainOf(useHealth().data?.models.report_writer);
  const [careless, setCareless] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  if (!r.data)
    return r.loading ? (
      <p className={s.muted} role="status">
        {writer.live ? `The ${writer.name} is writing it in plain words; every sentence is checked against the evidence…` : "Writing it in plain words…"}
      </p>
    ) : null;
  const engineOnly = r.data.lines.every((l) => l.by === "engine");
  const plain = r.data.lines.filter((l) => l.part === "plain" || l.by !== "engine");
  return (
    <Section title="In plain words" aside={engineOnly ? "no language model is on" : `written by the ${brainOf(r.data.explained_by).name}`}>
      {engineOnly ? (
        <p className={a.voiceEngine}>No language model is on: the engine's words above are the whole answer.</p>
      ) : (
        <div className={a.voiceModel}>
          <p className={a.voiceLabel}>Written by the {brainOf(r.data.explained_by).name}. Every sentence was checked against the evidence.</p>
          {plain.map((l, i) => (
            <p key={i}>
              {l.text} {l.cites.map((id) => <span key={id} className={a.cite}>{id}</span>)}
            </p>
          ))}
        </div>
      )}
      {r.data.removed.length > 0 && <Removed removed={r.data.removed} />}
      <p className={a.test}>
        {careless ? (
          <>
            <b>A deliberately careless writer</b>, to show the check at work:
          </>
        ) : (
          <Button
            kind="quiet"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setCareless(await report(caseId, "careless"));
              } finally {
                setBusy(false);
              }
            }}
          >
            Test the check with a careless writer
          </Button>
        )}
      </p>
      {careless && <Removed removed={careless.removed} />}
    </Section>
  );
}

function Removed({ removed }: { removed: Report["removed"] }) {
  return (
    <div className={a.removed}>
      <p className={a.voiceLabel}>Removed by the check</p>
      {removed.map((x, i) => (
        <p key={i}>
          <s>{x.text}</s> <span className={a.why}>{x.why}</span>
        </p>
      ))}
    </div>
  );
}

function WhatNext({ inv, entry, caseId, machineName }: { inv: Investigation; entry: CaseEntry | undefined; caseId: string; machineName: string }) {
  const navigate = useNavigate();
  const world = useWorld();
  const existing = world.workOrders.find((w) => w.caseId === caseId);
  const c = inv.conclusion!;
  const healthy = c.root_cause === "healthy";
  function draft() {
    const id = nextWorkOrderId(getWorld());
    upsertWorkOrder({
      id,
      kind: "case",
      caseId,
      machine: entry?.machine ?? "p2",
      title: `${fault(c.root_cause).name} on ${machineName}`,
      createdAt: Date.now(),
      stage: "plan",
    });
    navigate(`/work-order/${id}`);
  }
  const p = entry?.params;
  return (
    <Section title="What next">
      <div className={s.next}>
        {!healthy &&
          (existing ? (
            <ButtonLink to={`/work-order/${existing.id}`} kind="primary" size="l">
              Open the work order
            </ButtonLink>
          ) : (
            <Button kind="primary" size="l" onClick={draft}>
              Draft the work order
            </Button>
          ))}
        <ButtonLink to="/try" size="l">
          Investigate another
        </ButtonLink>
        {entry?.hidden && !entry.revealed && (
          <Button kind="quiet" onClick={() => patchCase(caseId, { revealed: true })}>
            Reveal what was fed in
          </Button>
        )}
      </div>
      {entry?.hidden && entry.revealed && p && (
        <p className={s.lead}>
          Fed in: <b>{fault(p.fault).name}</b>, {SEVERITY.find((x) => x.value === p.severity)?.label.toLowerCase() ?? `severity ${p.severity}`},{" "}
          {FLOOR.find((x) => x.value === p.extra_noise)?.label.toLowerCase() ?? `noise ${p.extra_noise}`}.{" "}
          {p.fault === c.root_cause ? "Crux named it." : "Crux named something else."}
        </p>
      )}
    </Section>
  );
}
