// The manager's page: the decisions that wait for a name, how each area
// stands, and what Crux did, counted from this session's investigations.

import { useState } from "react";
import { Link } from "react-router";
import { BadgeCheck, Building2, ClipboardCheck, ShieldCheck, Sparkles } from "lucide-react";
import { clock, pct, shortId } from "../lib/format";
import { fault } from "../lib/plain";
import { AREAS, SITE, machineOfCase } from "../lib/plant";
import { patchCase } from "../lib/session";
import { usePlant } from "../lib/useplant";
import { StackBar } from "../ui/charts";
import { Badge, Button, Card, Empty, LinkButton, PageHead, Stat } from "../ui/kit";
import { rowsOf } from "./parts";
import "../styles/plant.css";
import "./pages.css";

export default function Manager() {
  const { session, rows, tickets } = usePlant();
  const [by, setBy] = useState("");
  const cases = rowsOf(session.cases);
  const closed = cases.filter((r) => r.model.status === "concluded" || r.model.status === "unresolved");
  const faults = cases.filter((r) => r.model.status === "concluded" && r.model.leader && r.model.leader.kind !== "healthy");
  const toSign = faults.filter((r) => !r.entry.approved);
  const drafts = (tickets.data ?? []).filter((t) => t.status === "draft");
  const repaired = cases.filter((r) => r.entry.repair);
  const verified = repaired.filter((r) => r.entry.repair!.result.outcome === "verified");
  const alone = closed.filter((r) => r.entry.kind === "agents");
  const asked = cases.filter((r) => r.model.checks.length > 0);
  const declined = cases.filter((r) => r.model.status === "unresolved");
  const healthy = cases.filter((r) => r.model.status === "concluded" && r.model.leader?.kind === "healthy");

  return (
    <div className="page">
      <PageHead eyebrow={`${SITE.name} · Manager`} title="Summary" sub="Crux recommends; nothing is done to a machine until a person puts their name to it. These are the decisions waiting, and how the plant stands." />

      <div className="stats">
        <Stat label="Waiting for your sign-off" icon={<ClipboardCheck size={13} />} value={toSign.length + drafts.length} sub={`${toSign.length} from investigations, ${drafts.length} from alarms`} />
        <Stat label="Faults found" value={faults.length} sub="a cause named at 80% belief or more" />
        <Stat label="Repairs verified" icon={<BadgeCheck size={13} />} value={`${verified.length}/${repaired.length}`} sub="checked with a new reading after the repair" />
        <Stat label="Closed by Crux alone" icon={<Sparkles size={13} />} value={alone.length} unit={`of ${closed.length}`} sub="no person had to answer" />
        <Stat label="Declined to name a cause" value={declined.length} sub="it will not guess" />
      </div>

      <div className="split-even">
        <div className="col" style={{ gap: "var(--s-5)" }}>
          <Card
            title="Waiting for your sign-off"
            icon={<ClipboardCheck size={15} />}
            flush
            tone={toSign.length + drafts.length ? "warn" : undefined}
            actions={toSign.length > 0 && <input className="input input-sm" style={{ width: 170 }} placeholder="Signing as (your name)" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Your name, to approve work" />}
          >
            {toSign.length + drafts.length === 0 ? (
              <Empty left title="Nothing is waiting for you">
                When Crux names a fault, the work it recommends waits here until someone approves it.
              </Empty>
            ) : (
              <ul className="todo">
                {toSign.map((r) => (
                  <li key={r.entry.id}>
                    <div>
                      <h3>
                        {fault(r.model.leader!.kind).name} <span className="muted">on {machineOfCase(r.entry).name}</span>
                      </h3>
                      <p>
                        Belief {pct(r.model.leader!.belief)} · {r.model.ledger.length} pieces of evidence · investigated by {r.entry.kind === "agents" ? "Crux's AI investigators" : "the engine with a technician"}
                      </p>
                      {r.entry.inv?.conclusion?.recommended_action && <p style={{ marginTop: 4, color: "var(--text)" }}>{r.entry.inv.conclusion.recommended_action}</p>}
                    </div>
                    <div className="col" style={{ alignItems: "stretch" }}>
                      <Button size="sm" variant="primary" disabled={!by.trim()} title={by.trim() ? undefined : "Type your name above first"} onClick={() => patchCase(r.entry.id, { approved: { by: by.trim(), at: Date.now() } })}>
                        Approve the work
                      </Button>
                      <LinkButton to={`/cases/${r.entry.id}`} size="sm">
                        See the evidence
                      </LinkButton>
                    </div>
                  </li>
                ))}
                {drafts.map((t) => (
                  <li key={t.id}>
                    <div>
                      <h3>
                        {t.part_label} <span className="muted">on {t.machine_name}</span>
                      </h3>
                      <p>Work order {t.id}, drafted from an alarm on a watched machine.</p>
                    </div>
                    <LinkButton to={`/work-orders/${t.id}`} size="sm" variant="primary">
                      Review it
                    </LinkButton>
                  </li>
                ))}
              </ul>
            )}
            <div className="card-foot">An approval from an investigation is recorded in this browser; a work order from an alarm is stored by the server.</div>
          </Card>

          <Card title="Signed off" icon={<BadgeCheck size={15} />} flush>
            {faults.filter((r) => r.entry.approved).length === 0 ? (
              <Empty left title="Nothing has been approved yet" />
            ) : (
              <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th>Fault</th>
                    <th>Approved</th>
                    <th>After the repair</th>
                  </tr>
                </thead>
                <tbody>
                  {faults
                    .filter((r) => r.entry.approved)
                    .map((r) => (
                      <tr key={r.entry.id}>
                        <td className="strong">
                          <Link to={`/cases/${r.entry.id}`}>{machineOfCase(r.entry).short}</Link>
                        </td>
                        <td>{fault(r.model.leader!.kind).name}</td>
                        <td className="muted">
                          {r.entry.approved!.by} · {clock(r.entry.approved!.at)}
                        </td>
                        <td>{r.entry.repair ? <Badge tone={r.entry.repair.result.outcome === "verified" ? "ok" : "danger"}>{r.entry.repair.result.outcome.replace(/_/g, " ")}</Badge> : <span className="dim">repair not recorded yet</span>}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              </div>
            )}
          </Card>
        </div>

        <div className="col" style={{ gap: "var(--s-5)" }}>
          <Card title="By area" icon={<Building2 size={15} />} flush>
            <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Area</th>
                  <th className="t-num">Machines</th>
                  <th className="t-num">Normal</th>
                  <th className="t-num">Need a person</th>
                  <th className="t-num">Not looked at</th>
                </tr>
              </thead>
              <tbody>
                {AREAS.map((a) => {
                  const here = rows.filter((r) => r.m.area === a.id);
                  return (
                    <tr key={a.id}>
                      <td className="strong">{a.name}</td>
                      <td className="t-num">{here.length}</td>
                      <td className="t-num">{here.filter((r) => r.st.tone === "ok").length}</td>
                      <td className="t-num">{here.filter((r) => r.st.owner && r.st.owner !== "crux").length}</td>
                      <td className="t-num">{here.filter((r) => r.st.step < 0).length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
            <div className="card-foot">
              <Link to="/plant">Open the plant</Link>
            </div>
          </Card>

          <Card title="What Crux did" icon={<Sparkles size={15} />} sub="this session's investigations">
            {cases.length === 0 ? (
              <p className="muted">No reading has been investigated yet. Simulate a shift from the plant page to see a day's work.</p>
            ) : (
              <>
                <StackBar
                  height={10}
                  parts={[
                    { label: "Fault found", value: faults.length, tone: "warn" },
                    { label: "Nothing wrong", value: healthy.length, tone: "ok" },
                    { label: "No cause named", value: declined.length, tone: "muted" },
                    { label: "Waiting for a measurement", value: cases.filter((r) => r.model.status === "waiting").length, tone: "accent" },
                  ]}
                />
                <dl className="defs" style={{ marginTop: 14 }}>
                  <dt>Readings investigated</dt>
                  <dd className="num">{cases.length}</dd>
                  <dt>Fault found</dt>
                  <dd className="num">{faults.length}</dd>
                  <dt>Nothing wrong</dt>
                  <dd className="num">{healthy.length}</dd>
                  <dt>Asked for a measurement</dt>
                  <dd className="num">{asked.length}</dd>
                  <dt>Declined to name a cause</dt>
                  <dd className="num">{declined.length}</dd>
                </dl>
              </>
            )}
            <p className="small dim" style={{ marginTop: 12 }}>
              These are counts of what happened in this browser, on synthetic readings. They are not an accuracy figure.
            </p>
          </Card>

          <Card title="Can it be trusted?" icon={<ShieldCheck size={15} />}>
            <p className="muted">Crux names a cause only when the evidence carries it, and it shows what it measured, what it simulated and what it could not rule out. Its measured results, and what it does not claim, are on one page.</p>
            <div className="row row-wrap" style={{ marginTop: 10 }}>
              <LinkButton to="/proof" size="sm">
                Track record
              </LinkButton>
              <LinkButton to="/agents" size="sm" variant="ghost">
                How Crux works
              </LinkButton>
            </div>
            {cases[0] && (
              <p className="small dim" style={{ marginTop: 10 }}>
                Latest investigation: <Link to={`/cases/${cases[0].entry.id}`}>{shortId(cases[0].entry.id)}</Link> on {machineOfCase(cases[0].entry).name}.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
