// Every suspect and where its belief stands. Beliefs are the engine's; the
// table only sorts them.

import { ListTree } from "lucide-react";
import type { CaseModel, SuspectRow, SuspectState } from "../../lib/casemodel";
import { num, pct } from "../../lib/format";
import { fault } from "../../lib/plain";
import type { CaseEntry } from "../../lib/session";
import { Badge, Card, Meter, cx, type Tone } from "../../ui/kit";

const STATE: Record<SuspectState, { label: string; tone: Tone; tip: string }> = {
  leading: { label: "leading", tone: "accent", tip: "The suspect the evidence favours most" },
  live: { label: "live", tone: "neutral", tip: "Still possible on this evidence" },
  ruled_out: { label: "ruled out", tone: "neutral", tip: "Its belief fell below 3%" },
  unseen: { label: "cannot exclude", tone: "warn", tip: "A mild case would look the same in this evidence" },
  refused: { label: "refused", tone: "danger", tip: "The engine would not take this suspect" },
  untested: { label: "untested", tone: "neutral", tip: "Written but not yet simulated" },
};

export function SuspectsCard({
  model,
  entry,
  picked,
  onPick,
  onCite,
}: {
  model: CaseModel;
  entry: CaseEntry;
  picked: string | null;
  onPick: ((kind: string) => void) | null;
  onCite: (ids: string[]) => void;
}) {
  const steps = Object.keys(entry.trail)
    .map(Number)
    .sort((a, b) => a - b);
  const before = steps.length > 1 ? entry.trail[steps[steps.length - 2]] : null;
  const was = (kind: string) => before?.find((b) => b.kind === kind)?.posterior ?? null;
  const concluded = model.status === "concluded";

  return (
    <Card
      title="Suspects"
      icon={<ListTree size={15} />}
      sub={`${model.suspects.length} tested on a virtual copy of the pump`}
      flush
      foot="Only simulated likelihoods and measured evidence move a belief. A language model can add a suspect; it cannot score one."
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {onPick && <th style={{ width: 30, paddingRight: 0 }} aria-label="Show in the signal chart" />}
              <th>Suspect</th>
              <th style={{ minWidth: 190 }}>Belief</th>
              <th className="t-num" data-tip="How closely the simulated spectrum matches the measured one. A picture of the fit; beliefs come from the simulated likelihood.">
                Sim. match
              </th>
              <th>State</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {model.suspects.map((s) => (
              <Row key={s.kind} s={s} model={model} was={was(s.kind)} picked={picked === s.kind} onPick={onPick} onCite={onCite} verdict={concluded && s.state === "leading"} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Row({
  s,
  model,
  was,
  picked,
  onPick,
  onCite,
  verdict,
}: {
  s: SuspectRow;
  model: CaseModel;
  was: number | null;
  picked: boolean;
  onPick: ((kind: string) => void) | null;
  onCite: (ids: string[]) => void;
  verdict: boolean;
}) {
  const f = fault(s.kind);
  const st = verdict ? { label: "verdict", tone: "ok" as Tone, tip: "Named as the cause" } : STATE[s.state];
  const moved = was !== null && s.belief !== null && Math.abs(was - s.belief) >= 0.005;
  const canPick = onPick && s.origin === "catalogue";
  return (
    <tr className={cx("hover", s.state === "ruled_out" && "faded", picked && "on")}>
      {onPick && (
        <td style={{ paddingRight: 0 }}>
          {canPick && <button type="button" className={cx("pick", picked && "on")} onClick={() => onPick(s.kind)} aria-label={`Show ${f.name} in the signal chart`} aria-pressed={picked} />}
        </td>
      )}
      <td>
        <div className="suspect-name">
          <span className="row gap-1 row-wrap">
            <b>{f.name}</b>
            {s.origin === "written" && <Badge tone="model">written by the critic</Badge>}
          </span>
          <small>{f.technical}</small>
          {s.source && <span className="small t-model">cites {s.source}</span>}
        </div>
      </td>
      <td>
        <div className="belief-cell">
          <Meter value={s.belief ?? 0} mark={model.concludeAt} tone={verdict ? "ok" : s.state === "leading" ? "accent" : "neutral"} />
          <b className="num" style={{ textAlign: "right" }}>
            {pct(s.belief)}
          </b>
        </div>
        {moved && <div className="tiny dim num">was {pct(was)} before the last reading</div>}
      </td>
      <td className="t-num dim-cell">{s.match === null ? "–" : num(s.match, 2)}</td>
      <td>
        <Badge tone={st.tone} title={st.tip}>
          {st.label}
        </Badge>
      </td>
      <td>
        <div className="row gap-1 row-wrap">
          {s.supports.map((id) => (
            <button key={`s${id}`} type="button" className="chip" title="Supports it" onClick={() => onCite([id])}>
              + {id}
            </button>
          ))}
          {s.tensions.map((id) => (
            <button key={`t${id}`} type="button" className="chip" title="Counts against it" onClick={() => onCite([id])}>
              − {id}
            </button>
          ))}
          {s.supports.length + s.tensions.length === 0 && <span className="dim">–</span>}
        </div>
      </td>
    </tr>
  );
}
