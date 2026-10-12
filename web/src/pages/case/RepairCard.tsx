// After the repair: a new capture, investigated from scratch. Crux never
// touches a machine, so on the demo pump the visitor says what the repair did.

import { useState } from "react";
import { BadgeCheck, Wrench } from "lucide-react";
import { repair, type RepairChoice } from "../../api/crux";
import type { RepairResult } from "../../api/types";
import { num } from "../../lib/format";
import { patchCase, type CaseEntry } from "../../lib/session";
import { Badge, Callout, Card, cx, type Tone } from "../../ui/kit";

const REPAIR_SEED = 4242;

const CHOICES: { id: string; title: string; body: string; request: RepairChoice }[] = [
  { id: "good", title: "A good repair", body: "The fault is removed completely.", request: { removed: 1, seed: REPAIR_SEED } },
  { id: "half", title: "Half a repair", body: "Half of the fault is still there.", request: { removed: 0.5, seed: REPAIR_SEED } },
  {
    id: "misaligned",
    title: "Repaired, but left out of line",
    body: "The fault is gone, but reassembly left the motor and pump shafts out of line.",
    request: { removed: 1, left_behind: "misalignment", seed: REPAIR_SEED },
  },
];

const OUTCOME: Record<RepairResult["outcome"], { label: string; tone: Tone }> = {
  verified: { label: "Repair verified", tone: "ok" },
  still_there: { label: "Not verified: the fault is still there", tone: "danger" },
  something_else: { label: "That fault is gone, but something else shows", tone: "warn" },
  cause_gone: { label: "That fault is gone; the rest is not settled", tone: "warn" },
  cannot_tell: { label: "Not settled either way", tone: "neutral" },
};

export function RepairCard({ entry, cause, approvedBy }: { entry: CaseEntry; cause: string; approvedBy?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = entry.repair;
  const options = CHOICES.filter((o) => !(o.id === "misaligned" && cause === "misalignment"));

  async function choose(id: string) {
    const option = CHOICES.find((o) => o.id === id);
    if (!option) return;
    setBusy(id);
    setError(null);
    try {
      const result = await repair(entry.id, option.request);
      // The result carries the pump model's answer key. Nothing shows it, so it is not kept.
      patchCase(entry.id, { repair: { choice: id, at: Date.now(), result: { ...result, rig: null } } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const r = done?.result;
  const o = r ? OUTCOME[r.outcome] : null;

  return (
    <Card title="Repair check" icon={<Wrench size={15} />} sub="Did the fix work? A new reading, investigated from scratch" tone={o?.tone === "ok" ? "ok" : undefined}>
      <p className="muted" style={{ maxWidth: "82ch" }}>
        Crux never touches a machine. Here you stand in for the technician: say what the repair did, and the model takes a new reading of the machine in that state.
        {approvedBy && <> The work was approved by {approvedBy}.</>}
      </p>
      <div className="choices" style={{ marginTop: 12, gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((c) => (
          <button key={c.id} type="button" className={cx("choice", done?.choice === c.id && "on")} disabled={busy !== null || entry.lost} onClick={() => choose(c.id)}>
            <b>{busy === c.id ? "Taking a new reading…" : c.title}</b>
            <span>{c.body}</span>
          </button>
        ))}
      </div>
      {error && (
        <div style={{ marginTop: 12 }}>
          <Callout tone="danger">{error}</Callout>
        </div>
      )}
      {entry.lost && !r && <p className="small dim" style={{ marginTop: 10 }}>The server no longer holds this case, so it cannot check a repair on it.</p>}

      {r && o && (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
          <div className="row row-wrap">
            <BadgeCheck size={16} className={o.tone === "ok" ? "t-ok" : "dim"} aria-hidden />
            <h3 style={{ fontSize: "var(--fs-16)" }}>{o.label}</h3>
            <Badge tone="accent">the engine's words</Badge>
          </div>
          <p style={{ marginTop: 8, maxWidth: "88ch" }}>{r.statement}</p>
          {r.lines.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Line the named fault predicts</th>
                    <th className="t-num">Before</th>
                    <th className="t-num">After</th>
                    <th className="t-num" data-tip={`What a healthy machine shows, from ${r.usual_from}`}>
                      Healthy
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l) => (
                    <tr key={l.line}>
                      <td className="mono">{l.line}</td>
                      <td className="t-num">{num(l.before, 1)}×</td>
                      <td className="t-num strong">{num(l.after, 1)}×</td>
                      <td className="t-num dim-cell">{l.usual === null ? "–" : `${num(l.usual, 1)}×`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="small dim" style={{ marginTop: 6 }}>
                Each value is the line's height over its own noise floor.
              </p>
            </div>
          )}
          <dl className="voice">
            {r.asked.length > 0 && (
              <>
                <dt>Readings it took</dt>
                <dd>{r.asked.join(", ")}</dd>
              </>
            )}
            {r.limit && (
              <>
                <dt>Limit</dt>
                <dd>{r.limit}</dd>
              </>
            )}
            {r.caveat && (
              <>
                <dt>Caveat</dt>
                <dd>{r.caveat}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </Card>
  );
}
