// Sign-offs: the decisions that wait for a name, first. What was signed off and
// what Crux did this session are a tab away each (?tab=signed|session).

import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { BadgeCheck, ClipboardCheck, Sparkles } from "lucide-react";
import { clock, pct } from "../lib/format";
import { usePresence } from "../lib/glide";
import { fault } from "../lib/plain";
import { SITE, machineOfCase } from "../lib/plant";
import { patchCase } from "../lib/session";
import { usePlant } from "../lib/useplant";
import { StackBar } from "../ui/charts";
import { Badge, Button, Card, CountUp, Empty, Hint, LinkButton, PageHead, Ring, Tabs, cx, toast } from "../ui/kit";
import { rowsOf, type CaseRow } from "./parts";
import "../styles/plant.css";
import "./pages.css";

// The signer's name is kept in this browser, so it is typed once.
const SIGNER = "crux.signer";
function storedName(): string {
  try {
    return window.localStorage.getItem(SIGNER) ?? "";
  } catch {
    return "";
  }
}
function keepName(name: string) {
  try {
    window.localStorage.setItem(SIGNER, name);
  } catch {
    /* kept for this page only */
  }
}

type Tab = "waiting" | "signed" | "session";
const TABS: Tab[] = ["waiting", "signed", "session"];

type Decision = { key: string; row?: CaseRow; ticket?: { id: string; part: string; machine: string } };

export default function Manager() {
  const { session, tickets } = usePlant();
  const [params, setParams] = useSearchParams();
  const pickedTab = params.get("tab") as Tab | null;
  const tab: Tab = pickedTab && TABS.includes(pickedTab) ? pickedTab : "waiting";
  const [name, setName] = useState(storedName);
  const [editing, setEditing] = useState(() => storedName() === "");
  const cases = rowsOf(session.cases);
  const faults = cases.filter((r) => r.model.status === "concluded" && r.model.leader && r.model.leader.kind !== "healthy");
  const signed = faults.filter((r) => r.entry.approved).sort((a, b) => b.entry.approved!.at - a.entry.approved!.at);
  const decisions: Decision[] = [
    ...faults.filter((r) => !r.entry.approved).map((r) => ({ key: r.entry.id, row: r })),
    ...(tickets.data ?? []).filter((t) => t.status === "draft").map((t) => ({ key: t.id, ticket: { id: t.id, part: t.part_label, machine: t.machine_name } })),
  ];
  const shown = usePresence(decisions, (d) => d.key);
  const healthy = cases.filter((r) => r.model.status === "concluded" && r.model.leader?.kind === "healthy");
  const declined = cases.filter((r) => r.model.status === "unresolved");
  const waiting = cases.filter((r) => r.model.status === "waiting");
  const asked = cases.filter((r) => r.model.checks.length > 0);
  const signer = name.trim();

  function approve(r: CaseRow) {
    if (!signer) return;
    keepName(signer);
    setEditing(false);
    patchCase(r.entry.id, { approved: { by: signer, at: Date.now() } });
    toast(`Approved: ${fault(r.model.leader!.kind).name.toLowerCase()} on ${machineOfCase(r.entry).short}.`);
  }

  const signerControl =
    editing || !signer ? (
      <label className="signer">
        Signing as
        <input
          className="input input-sm"
          value={name}
          placeholder="Your name"
          aria-label="Your name, to approve work"
          onChange={(e) => {
            setName(e.target.value);
            keepName(e.target.value.trim());
          }}
          onKeyDown={(e) => e.key === "Enter" && signer && setEditing(false)}
        />
      </label>
    ) : (
      <span className="signer">
        Signing as <b>{signer}</b>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Change name
        </Button>
      </span>
    );

  return (
    <div className="page">
      <PageHead eyebrow={`${SITE.name} · for the manager`} title="Sign-offs" sub="Nothing is done to a machine until a person signs." />

      <Tabs
        value={tab}
        onChange={(t) => setParams(t === "waiting" ? {} : { tab: t }, { replace: true })}
        label="Sign-offs"
        tabs={[
          { id: "waiting", label: "Waiting", count: decisions.length || undefined },
          { id: "signed", label: "Signed off", count: signed.length || undefined },
          { id: "session", label: "This session" },
        ]}
      />

      <div className="col narrow" style={{ gap: "var(--s-4)" }}>
        {tab === "waiting" && (
          <Card
            title="Decisions"
            icon={<ClipboardCheck size={15} />}
            sub={decisions.length > 0 ? <CountUp value={decisions.length} /> : undefined}
            flush
            tone={decisions.length ? "warn" : undefined}
            actions={decisions.some((d) => d.row) ? signerControl : undefined}
            foot={decisions.some((d) => d.row) ? "Approvals are kept in this browser." : undefined}
          >
            {shown.length === 0 ? (
              <Empty left title="Nothing to decide" action={session.cases.length === 0 ? <LinkButton to="/go/shift" size="sm">Start a shift</LinkButton> : undefined} />
            ) : (
              <ul className="inbox" data-tour="manager-decisions">
                {shown.map(({ item: d, key, leaving }) => (
                  <li key={key} className={cx("job", leaving && "leaving")}>
                    {d.row ? (
                      <div className="decision-in">
                        <Ring value={d.row.model.leader!.belief ?? 0} mark={d.row.model.concludeAt} size={56} stroke={5} tone="accent">
                          {pct(d.row.model.leader!.belief)}
                        </Ring>
                        <div>
                          <div className="decision-what">{fault(d.row.model.leader!.kind).name}</div>
                          <div className="job-meta">
                            {machineOfCase(d.row.entry).name} · {d.row.entry.kind === "agents" ? "Crux's AI" : "engine and technician"} ·{" "}
                            <Link to={`/cases/${d.row.entry.id}?tab=evidence`}>{d.row.model.ledger.length} pieces of evidence</Link>
                          </div>
                          {d.row.entry.inv?.conclusion?.recommended_action && (
                            <div className="decision-rec" title={d.row.entry.inv.conclusion.recommended_action}>
                              {d.row.entry.inv.conclusion.recommended_action}
                            </div>
                          )}
                        </div>
                        <div className="job-acts">
                          <Button size="sm" variant="primary" disabled={!signer || leaving} title={signer ? undefined : "Type your name first"} onClick={() => approve(d.row!)}>
                            Approve work
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="decision-in">
                        <span className="job-icon tone-neutral" aria-hidden>
                          <ClipboardCheck size={15} />
                        </span>
                        <div>
                          <div className="decision-what">{d.ticket!.part}</div>
                          <div className="job-meta">
                            {d.ticket!.machine} · work order from an alarm
                          </div>
                        </div>
                        <div className="job-acts">
                          <LinkButton to={`/work-orders/${d.ticket!.id}`} size="sm" variant="primary">
                            Review work order
                          </LinkButton>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {tab === "signed" && (
          <Card title="Signed off" icon={<BadgeCheck size={15} />} sub={signed.length || undefined} flush>
            {signed.length === 0 ? (
              <Empty left title="Nothing signed off yet" />
            ) : (
              <ul className="quiet-list">
                {signed.map((r) => (
                  <li key={r.entry.id} className="needs-row">
                    <div className="grow">
                      <Link to={`/cases/${r.entry.id}?tab=after`} className="strong">
                        {fault(r.model.leader!.kind).name}
                      </Link>
                      <small>
                        {machineOfCase(r.entry).short} · {r.entry.approved!.by} · {clock(r.entry.approved!.at)}
                      </small>
                    </div>
                    {r.entry.repair ? (
                      <Badge tone={r.entry.repair.result.outcome === "verified" ? "ok" : "danger"}>{r.entry.repair.result.outcome.replace(/_/g, " ")}</Badge>
                    ) : (
                      <span className="owner crew">Repair to do</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {tab === "session" && (
          <>
            <Card
              title={
                <>
                  This session
                  <Hint label="About these counts">Counts of what happened in this browser, on synthetic readings. Not an accuracy figure.</Hint>
                </>
              }
              icon={<Sparkles size={15} />}
            >
              {cases.length === 0 ? (
                <p className="muted">Nothing investigated yet.</p>
              ) : (
                <>
                  <StackBar
                    height={8}
                    parts={[
                      { label: "Fault found", value: faults.length, tone: "warn" },
                      { label: "Nothing wrong", value: healthy.length, tone: "ok" },
                      { label: "No cause named", value: declined.length, tone: "muted" },
                      { label: "Waiting for a measurement", value: waiting.length, tone: "accent" },
                    ]}
                  />
                  <div className="counts">
                    <div>
                      <b className="num">
                        <CountUp value={cases.length} />
                      </b>
                      <span>readings investigated</span>
                    </div>
                    <div>
                      <b className="num">
                        <CountUp value={faults.length} />
                      </b>
                      <span>faults found</span>
                    </div>
                    <div>
                      <b className="num">
                        <CountUp value={healthy.length} />
                      </b>
                      <span>nothing wrong</span>
                    </div>
                    <div>
                      <b className="num">
                        <CountUp value={asked.length} />
                      </b>
                      <span>asked for a measurement</span>
                    </div>
                    <div>
                      <b className="num">
                        <CountUp value={declined.length} />
                      </b>
                      <span>no cause named</span>
                    </div>
                  </div>
                </>
              )}
            </Card>
            <p className="foot-note">
              Measured results: <Link to="/proof">Track record</Link> · <Link to="/agents">How Crux works</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
