// Pieces more than one page shows.

import { useRef } from "react";
import { Link, useNavigate } from "react-router";
import { Bot, Cpu } from "lucide-react";
import { STATUS_LABEL, STATUS_TONE, modelOf, type CaseModel, type CaseStatus } from "../lib/casemodel";
import { clock, pct, shortId, stamp } from "../lib/format";
import { getLiveRun } from "../lib/liveruns";
import { check, fault } from "../lib/plain";
import { machineOfCase } from "../lib/plant";
import type { CaseEntry } from "../lib/session";
import { Badge, Meter, cx, vt } from "../ui/kit";
import "../styles/app.css";

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

const SHORT: Record<CaseStatus, string> = { waiting: "Waiting", open: "Investigating", concluded: "Cause named", unresolved: "No cause" };

/** The state in a word or two. Keyed by the state, so a change of state is seen as it comes in. */
export function StatusBadge({ m }: { m: CaseModel }) {
  return (
    <span key={m.status} className="state-in">
      <Badge tone={STATUS_TONE[m.status]} dot title={STATUS_LABEL[m.status]}>
        {SHORT[m.status]}
      </Badge>
    </span>
  );
}

/** An investigation of Crux's AI with no result yet: still arriving, or cut off before it finished. */
export const isLiveRun = (e: CaseEntry) => !e.failed && !!getLiveRun(e.id)?.streaming;

const when = (t: number) => (new Date(t).toDateString() === new Date().toDateString() ? clock(t) : stamp(t));

/**
 * The list of investigations. `brief` drops the columns a narrow card has no
 * room for. `pending` adds runs of Crux's AI that have no result yet.
 */
export function CaseTable({ rows, brief, pending = [] }: { rows: CaseRow[]; brief?: boolean; pending?: CaseEntry[] }) {
  const navigate = useNavigate();
  const open = (id: string) => navigate(`/cases/${id}`, { viewTransition: true });
  // Rows that arrive after the list is first drawn come in visibly; the first ones do not.
  const known = useRef<Set<string> | null>(null);
  known.current ??= new Set([...rows.map((r) => r.entry.id), ...pending.map((e) => e.id)]);
  const fresh = (id: string) => !known.current!.has(id);
  // A machine's name grows into its investigation's page, but only where the name is not repeated here.
  const times = new Map<string, number>();
  for (const e of [...pending, ...rows.map((r) => r.entry)]) times.set(machineOfCase(e).id, (times.get(machineOfCase(e).id) ?? 0) + 1);

  const row = (entry: CaseEntry, cells: React.ReactNode) => {
    const m = machineOfCase(entry);
    return (
      <tr
        key={entry.id}
        className={cx("hover link", fresh(entry.id) && "row-in")}
        onClick={(e) => !(e.target as HTMLElement).closest("a, button") && open(entry.id)}
      >
        <td className="c-machine">
          <Link to={`/cases/${entry.id}`} viewTransition className="case-link">
            <b style={!brief && times.get(m.id) === 1 ? vt(`m-${m.id}`) : undefined}>{m.short}</b>
          </Link>{" "}
          <span className="mono dim small">{shortId(entry.id)}</span>
          {entry.lost && (
            <span className="dim small" title="The server no longer holds it; this is the last state this browser read">
              {" "}
              · kept here
            </span>
          )}
        </td>
        {cells}
        {!brief && (
          <td className="c-who nowrap">
            <span className="row gap-1">
              {entry.kind === "agents" ? <Bot size={14} className="t-model" aria-hidden /> : <Cpu size={14} className="t-accent" aria-hidden />}
              <span title={entry.kind === "agents" ? "Crux's AI" : "The engine, with a technician"}>{entry.kind === "agents" ? "Crux's AI" : "Engine"}</span>
            </span>
          </td>
        )}
        <td className="c-when t-num dim-cell">{when(entry.createdAt)}</td>
      </tr>
    );
  };

  return (
    <div className="table-wrap">
      <table className={cx("table", "case-table", brief && "brief")}>
        <thead>
          <tr>
            <th>Machine</th>
            <th>State</th>
            <th>Finding</th>
            <th style={{ minWidth: 130 }}>Belief</th>
            {!brief && <th>By</th>}
            <th className="t-num">When</th>
          </tr>
        </thead>
        <tbody>
          {pending.map((entry) => {
            const live = isLiveRun(entry);
            return row(
              entry,
              <>
                <td className="c-state">
                  <Badge tone={live ? "accent" : "neutral"} dot pulse={live} title={live ? "Crux's AI is on it now" : (entry.failed ?? "The page was reloaded while it ran")}>
                    {live ? "Investigating" : "Not finished"}
                  </Badge>
                </td>
                <td className="c-finding dim">–</td>
                <td className="c-belief" />
              </>,
            );
          })}
          {rows.map(({ entry, model }) =>
            row(
              entry,
              <>
                <td className="c-state">
                  <StatusBadge m={model} />
                </td>
                <td className="c-finding">
                  <span className="strong">{finding(model)}</span>
                  {model.leader?.origin === "written" && model.status === "concluded" && (
                    <>
                      {" "}
                      <Badge tone="model" title="A suspect Crux's AI wrote; the physics tested it">
                        written suspect
                      </Badge>
                    </>
                  )}
                </td>
                <td className="c-belief">
                  <div className="belief-cell" style={{ minWidth: 110 }}>
                    <Meter value={model.leader?.belief ?? 0} mark={model.concludeAt} tone={model.status === "concluded" ? "ok" : "neutral"} />
                    <span className="num" style={{ textAlign: "right" }}>
                      {pct(model.leader?.belief)}
                    </span>
                  </div>
                </td>
              </>,
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
