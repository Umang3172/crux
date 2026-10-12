// Pieces more than one page shows.

import { useNavigate } from "react-router";
import { Bot, Cpu } from "lucide-react";
import { STATUS_LABEL, STATUS_TONE, modelOf, type CaseModel } from "../lib/casemodel";
import { pct, shortId, stamp } from "../lib/format";
import { check, fault } from "../lib/plain";
import type { CaseEntry } from "../lib/session";
import { Badge, Meter } from "../ui/kit";

export type CaseRow = { entry: CaseEntry; model: CaseModel };

export const rowsOf = (cases: CaseEntry[]): CaseRow[] =>
  cases
    .map((entry) => ({ entry, model: modelOf(entry) }))
    .filter((r): r is CaseRow => r.model !== null)
    .sort((a, b) => b.entry.createdAt - a.entry.createdAt);

/** What the case found, or what it is waiting on, in a few words. */
export function finding(m: CaseModel): string {
  if (m.status === "concluded" && m.leader) return fault(m.leader.kind).name;
  if (m.status === "unresolved") return "No cause named";
  if (m.status === "waiting") {
    const w = m.checks.find((c) => c.status === "waiting");
    return w ? `Needs: ${check(w.testId).name.toLowerCase()}` : "Needs a measurement";
  }
  return "Investigating";
}

export function StatusBadge({ m }: { m: CaseModel }) {
  return (
    <Badge tone={STATUS_TONE[m.status]} dot pulse={m.status === "waiting"}>
      {STATUS_LABEL[m.status]}
    </Badge>
  );
}

/** `brief` drops the columns a narrow card has no room for. */
export function CaseTable({ rows, brief }: { rows: CaseRow[]; brief?: boolean }) {
  const navigate = useNavigate();
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Case</th>
            <th>State</th>
            <th>Finding</th>
            <th style={{ minWidth: 130 }}>Belief</th>
            <th>Investigated by</th>
            {!brief && <th className="t-num">Evidence</th>}
            {!brief && <th className="t-num">Opened</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ entry, model }) => (
            <tr
              key={entry.id}
              className="hover link"
              tabIndex={0}
              onClick={() => navigate(`/cases/${entry.id}`)}
              onKeyDown={(e) => e.key === "Enter" && navigate(`/cases/${entry.id}`)}
            >
              <td className="mono nowrap">
                {shortId(entry.id)}
                {entry.lost && (
                  <span className="dim" title="The server no longer holds this case">
                    {" "}
                    · kept here
                  </span>
                )}
              </td>
              <td>
                <StatusBadge m={model} />
              </td>
              <td>
                <span className="strong">{finding(model)}</span>
                {model.leader?.origin === "written" && model.status === "concluded" && (
                  <>
                    {" "}
                    <Badge tone="model">written suspect</Badge>
                  </>
                )}
              </td>
              <td>
                <div className="belief-cell" style={{ minWidth: 110 }}>
                  <Meter value={model.leader?.belief ?? 0} mark={model.concludeAt} tone={model.status === "concluded" ? "ok" : "neutral"} />
                  <span className="num" style={{ textAlign: "right" }}>
                    {pct(model.leader?.belief)}
                  </span>
                </div>
              </td>
              <td className="nowrap">
                <span className="row gap-1">
                  {entry.kind === "agents" ? <Bot size={14} className="t-model" aria-hidden /> : <Cpu size={14} className="t-accent" aria-hidden />}
                  {entry.kind === "agents" ? "Agents" : "Engine + person"}
                </span>
              </td>
              {!brief && <td className="t-num">{model.ledger.length}</td>}
              {!brief && <td className="t-num dim-cell">{stamp(entry.createdAt)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
