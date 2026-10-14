// After the repair: a new reading, investigated from scratch. Crux never
// touches a machine, so on the modelled machine the visitor says what the
// repair did and the model takes a new reading of it in that state.

import { useState } from "react";
import { BadgeCheck, Wrench } from "lucide-react";
import { repair, type RepairChoice } from "../../api/crux";
import type { RepairResult } from "../../api/types";
import { num } from "../../lib/format";
import { patchCase, type CaseEntry } from "../../lib/session";
import { Badge, Callout, Card, Empty, Hint, SourceTag, cx, toast, type Tone } from "../../ui/kit";
import { Clamp, EngineWords } from "./bits";

const REPAIR_SEED = 4242;

const CHOICES: { id: string; title: string; body: string; request: RepairChoice }[] = [
  { id: "good", title: "Good repair", body: "Fault fully removed", request: { removed: 1, seed: REPAIR_SEED } },
  { id: "half", title: "Half a repair", body: "Half the fault remains", request: { removed: 0.5, seed: REPAIR_SEED } },
  { id: "misaligned", title: "Left out of line", body: "Fault gone, shafts misaligned", request: { removed: 1, left_behind: "misalignment", seed: REPAIR_SEED } },
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
      // The result carries the model's answer key. Nothing shows it, so it is not kept.
      patchCase(entry.id, { repair: { choice: id, at: Date.now(), result: { ...result, rig: null } } });
      toast(OUTCOME[result.outcome]?.label ?? "Repair checked", OUTCOME[result.outcome]?.tone ?? "neutral");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const r = done?.result;
  const o = r ? OUTCOME[r.outcome] : null;
  // A repair is recorded once someone has approved it.
  const open = !!approvedBy || !!done;

  return (
    <Card
      id="repair"
      title="Repair check"
      icon={<Wrench size={15} />}
      tone={o?.tone === "ok" ? "ok" : undefined}
      actions={
        <>
          <SourceTag source="engine's model · synthetic" />
          <Hint label="About the repair check">Crux never touches a machine. Here you stand in for the technician: say what the repair did, and the model takes a new reading of the machine in that state, investigated from scratch.</Hint>
        </>
      }
    >
      {!open ? (
        <Empty left title="Waiting for approval">
          A repair is recorded once someone approves it.
        </Empty>
      ) : (
        <>
          <p className="small muted repair-lead">Simulated: say what the repair did; the model takes a new reading.</p>
          <div className="choices" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
            {options.map((c) => (
              <button key={c.id} type="button" className={cx("choice", done?.choice === c.id && "on")} disabled={busy !== null || entry.lost} onClick={() => choose(c.id)}>
                <b>{busy === c.id ? "Taking a new reading…" : c.title}</b>
                <span>{c.body}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {error && (
        <div style={{ marginTop: 12 }}>
          <Callout tone="danger">{error}</Callout>
        </div>
      )}

      {r && o && (
        <div className="repair-result">
          <div className="row row-wrap">
            <BadgeCheck size={16} className={o.tone === "ok" ? "t-ok" : "dim"} aria-hidden />
            <h3>{o.label}</h3>
            <EngineWords />
          </div>
          <Clamp lines={3}>{r.statement}</Clamp>
          {r.lines.length > 0 && (
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th data-tip="Each value is the line's height over its own noise floor">Line</th>
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
            </div>
          )}
          {(r.asked.length > 0 || r.limit || r.caveat) && (
            <dl className="vd-rows">
              {r.asked.length > 0 && (
                <>
                  <dt>Readings taken</dt>
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
          )}
          {done && approvedBy && (
            <p className="small dim">
              Approved by {approvedBy} · <Badge plain>recorded in this browser</Badge>
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
