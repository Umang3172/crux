// Work orders. The server drafts one from a forecast alarm and a person
// approves it by name; an investigation's recommendation is approved on the
// investigation and listed here. Crux recommends; it never acts on a machine.

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { BadgeCheck, Camera, ChevronRight, ClipboardList, ShieldAlert } from "lucide-react";
import { approveTicket, fleetStatus, machines as fetchMachines, outcome as sendOutcome, ticketStillUrl, tickets as fetchTickets } from "../api/crux";
import type { Lesson, Ticket } from "../api/types";
import { brainOf } from "../lib/ai";
import { clock, hours, num, pct, shortId } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { fault } from "../lib/plain";
import { machineOfCase } from "../lib/plant";
import { useSession } from "../lib/session";
import { Badge, Button, Callout, Card, Empty, ErrorState, Hint, LinkButton, PageHead, Seg, SkeletonRows, Stat, cx, toast } from "../ui/kit";
import { rowsOf } from "./parts";
import "./pages.css";
import "../styles/trust.css";

const writer = (by: string) => (by === "template" || !by ? "a template" : brainOf(by).live ? brainOf(by).name : by);
const range = (t: Ticket) => (t.fix_within_h ? `${hours(t.fix_within_h[0])} to ${hours(t.fix_within_h[1])}` : "–");

function State({ t }: { t: Ticket }) {
  return (
    <Badge tone={t.status === "approved" ? "ok" : "warn"} dot>
      {t.status === "approved" ? `approved by ${t.approved_by}` : "waiting for approval"}
    </Badge>
  );
}

export function WorkOrders() {
  const navigate = useNavigate();
  const list = useAsync(() => fetchTickets(), []);
  const lives = useAsync(() => fetchMachines(), []);
  const session = useSession();
  const handoffs = rowsOf(session.cases).filter((r) => r.model.status === "concluded" && r.model.leader && r.model.leader.kind !== "healthy");
  const life = lives.data?.machines[0];

  return (
    <div className="page tr-page">
      <PageHead title="Work orders" sub="Crux recommends. A person approves." />

      <Card title="From alarms" icon={<ClipboardList size={15} />} flush actions={<Hint label="Where these come from">Drafted by the server when a watched machine's alarm fires. Kept in its memory until it restarts.</Hint>}>
        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <SkeletonRows />
        ) : list.data.length === 0 ? (
          <Empty icon={<ClipboardList size={18} />} title="No work orders yet" action={<LinkButton variant="primary" to={life ? `/lives/${life.machine}` : "/plant"}>Open a watched machine</LinkButton>}>
            Draft one from a watched machine's alarm.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Machine</th>
                  <th>Part</th>
                  <th>Fix within</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((t) => (
                  <tr key={t.id} className="hover link" tabIndex={0} onClick={() => navigate(`/work-orders/${t.id}`)} onKeyDown={(e) => e.key === "Enter" && navigate(`/work-orders/${t.id}`)}>
                    <td className="mono">{t.id}</td>
                    <td className="strong">{t.machine_name}</td>
                    <td>{t.part_label}</td>
                    <td className="num nowrap">{range(t)}</td>
                    <td>
                      <span className="row gap-1 row-wrap">
                        {t.hazard && <Badge tone="danger">hazard</Badge>}
                        <State t={t} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="From investigations" icon={<BadgeCheck size={15} />} flush actions={<Hint label="Where these come from">Causes named by this browser's investigations. Each is approved on its investigation.</Hint>}>
        {handoffs.length === 0 ? (
          <Empty left title="No cause named yet">
            A named cause waits here for approval.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Machine</th>
                  <th>Cause named</th>
                  <th>Approval</th>
                  <th>Repair check</th>
                </tr>
              </thead>
              <tbody>
                {handoffs.map(({ entry, model }) => (
                  <tr key={entry.id} className="hover link" tabIndex={0} onClick={() => navigate(`/cases/${entry.id}`)} onKeyDown={(e) => e.key === "Enter" && navigate(`/cases/${entry.id}`)}>
                    <td className="nowrap">
                      <Link to={`/cases/${entry.id}`}>{machineOfCase(entry).short}</Link> <span className="mono dim small">{shortId(entry.id)}</span>
                    </td>
                    <td className="strong">
                      {fault(model.leader!.kind).name} <span className="dim num">· {pct(model.leader!.belief)}</span>
                    </td>
                    <td>
                      {entry.approved ? (
                        <Badge tone="ok" dot>
                          approved by {entry.approved.by} · {clock(entry.approved.at)}
                        </Badge>
                      ) : (
                        <Badge tone="warn" dot>
                          waiting for approval
                        </Badge>
                      )}
                    </td>
                    <td>{entry.repair ? <Badge tone={entry.repair.result.outcome === "verified" ? "ok" : "neutral"}>{entry.repair.result.outcome.replace(/_/g, " ")}</Badge> : <span className="dim">not checked yet</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function WorkOrderPage() {
  const { id } = useParams();
  const list = useAsync(() => fetchTickets(), [id]);
  const fleet = useAsync(() => fleetStatus(), []);
  const [cited, setCited] = useState<string[]>([]);
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState<Ticket | null>(null);

  const t = approved ?? list.data?.find((x) => x.id === id) ?? null;

  async function approve() {
    if (!t) return;
    setBusy(true);
    setError(null);
    try {
      setApproved(await approveTicket(t.id, by.trim()));
      toast("Work order approved");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (list.error) {
    return (
      <div className="page tr-page">
        <ErrorState error={list.error} onRetry={list.reload} />
      </div>
    );
  }
  if (!list.data) {
    return (
      <div className="page tr-page">
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      </div>
    );
  }
  if (!t) {
    return (
      <div className="page tr-page">
        <Card>
          <Empty icon={<ClipboardList size={18} />} title="No such work order here" action={<LinkButton to="/work-orders">All work orders</LinkButton>}>
            The server keeps work orders in memory; a restart clears them.
          </Empty>
        </Card>
      </div>
    );
  }

  return (
    <div className="page tr-page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/work-orders">Work orders</Link>
        <ChevronRight size={12} aria-hidden />
        <span className="mono">{t.id}</span>
      </nav>
      <PageHead title={`${t.part_label}, ${t.machine_name}`} sub={`Drafted at running hour ${num(t.at_h, 1)} by ${writer(t.written_by)}.`} actions={<State t={t} />} />

      {t.hazard && (
        <Callout tone="danger" icon={<ShieldAlert size={15} />}>
          Hazard reported. Make the machine safe under the site's procedure first.
        </Callout>
      )}

      <div className="stats">
        <Stat label="Fix within" value={<span style={{ fontSize: "var(--fs-20)" }}>{range(t)}</span>} sub={t.likely_h !== null ? `likely ${hours(t.likely_h)} · a range for planning` : "a range for planning"} />
        <Stat label="Next planned stop" value={<span style={{ fontSize: "var(--fs-20)" }}>{t.stop_in_h !== null ? `in ${hours(t.stop_in_h)}` : "–"}</span>} sub="as entered when drafted" />
        <Stat label="Risk before that stop" value={t.risk_before_stop !== null ? pct(t.risk_before_stop) : "–"} sub="of reaching the danger line first" />
        <Stat label="Written by" value={<span style={{ fontSize: "var(--fs-20)" }}>{writer(t.written_by)}</span>} sub={t.removed.length > 0 ? `${t.removed.length} sentence${t.removed.length > 1 ? "s" : ""} removed by the check` : "nothing removed by the check"} />
      </div>

      <div className="split">
        <div className="col" style={{ gap: "var(--s-5)" }}>
          <Card title="The work order" icon={<ClipboardList size={15} />} actions={<Hint label="About the evidence ids">Every sentence cites the evidence it rests on. Pick an id to find it below.</Hint>}>
            <ol className="tr-lines">
              {t.sentences.map((s, i) => (
                <li key={i}>
                  {s.text}
                  {s.cites.map((c) => (
                    <button key={c} type="button" className={cx("chip", cited.includes(c) && "on")} onClick={() => setCited(s.cites)}>
                      {c}
                    </button>
                  ))}
                </li>
              ))}
            </ol>
            {t.removed.length > 0 && (
              <div className="col" style={{ marginTop: 14 }}>
                <h3>Removed by the check</h3>
                {t.removed.map((r, i) => (
                  <div className="removed" key={i}>
                    <s>{r.text}</s>
                    <span>The evidence it cites does not back it.</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 14 }}>
              <Callout tone="accent">{t.safety}</Callout>
            </div>
          </Card>

          <Card title="Evidence" icon={<ClipboardList size={15} />} flush>
            <div className="table-wrap">
              <table className="table compact">
                <tbody>
                  {t.evidence.map((e) => (
                    <tr key={e.id} className={cited.includes(e.id) ? "on" : undefined}>
                      <td style={{ width: 54 }}>
                        <span className={cx("chip", cited.includes(e.id) && "on")}>{e.id}</span>
                      </td>
                      <td>{e.statement}</td>
                      <td style={{ textAlign: "right" }}>
                        <Badge tone={e.kind === "forecast" ? "warn" : e.kind === "sensor" ? "neutral" : "accent"} plain>
                          {e.kind}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {t.camera && (
            <Card title="Camera look" icon={<Camera size={15} />} sub={`${t.camera.camera} · looked at by ${t.camera.inspected_by}`} actions={<Badge tone="warn">unconfirmed</Badge>}>
              <Callout tone="model">Unconfirmed until a person checks it. {t.camera.note}</Callout>
              {t.has_still && <img className="still" style={{ marginTop: 12 }} src={ticketStillUrl(t.id)} alt="The still the camera look was made from" />}
              {t.camera.retake && <p className="t-warn small" style={{ marginTop: 8 }}>Retake asked for: {t.camera.retake}</p>}
              {(t.camera.checklist.length > 0 || t.camera.findings.length > 0) && (
                <div className="table-wrap" style={{ marginTop: 12 }}>
                  <table className="table compact">
                    <thead>
                      <tr>
                        <th>Looked for</th>
                        <th>Result</th>
                        <th>Where</th>
                        <th>Seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(t.camera.checklist.length ? t.camera.checklist : t.camera.findings).map((f, i) => (
                        <tr key={i}>
                          <td className="strong">{f.item}</td>
                          <td>
                            <Badge tone={f.status === "present" ? (f.hazard ? "danger" : "warn") : "neutral"}>{f.status.replace(/_/g, " ")}</Badge>
                          </td>
                          <td className="muted">{f.where || "–"}</td>
                          <td className="muted">{f.evidence || f.what}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>

        <aside className="col rail" style={{ gap: "var(--s-5)" }}>
          <Card title="Approval" icon={<BadgeCheck size={15} />} tone={t.status === "approved" ? "ok" : "warn"}>
            {t.status === "approved" ? (
              <p>
                Approved by <b>{t.approved_by}</b>.
              </p>
            ) : (
              <div className="col gap-3">
                <input className="input" placeholder="Your name" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Your name, to approve" />
                <Button variant="primary" block busy={busy} disabled={!by.trim()} onClick={approve}>
                  Approve work order
                </Button>
                {error && <Callout tone="danger">{error}</Callout>}
              </div>
            )}
          </Card>
          {t.status === "approved" && <Found ticket={t} hub={(fleet.data?.hub_versions.length ?? 0) > 0} />}
          {t.notes.length > 0 && (
            <Card title="Notes" flush>
              <ul className="tr-rows">
                {t.notes.map((n, i) => (
                  <li key={i} className="muted">
                    {n}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

/** After the repair: what was found, kept as a lesson for the next machine like this one. */
function Found({ ticket, hub }: { ticket: Ticket; hub: boolean }) {
  const [found, setFound] = useState("");
  const [right, setRight] = useState<"yes" | "no">("yes");
  const [by, setBy] = useState(ticket.approved_by);
  const [major, setMajor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ lesson: Lesson; sent_to_hub: boolean; alert: string | null } | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      setSaved(await sendOutcome({ ticket_id: ticket.id, found: found.trim(), right: right === "yes", by: by.trim(), major: hub && major }));
      toast("Lesson saved");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <Card title="Lesson saved" icon={<BadgeCheck size={15} />} tone="ok" className="tr-enter">
        <b>{saved.lesson.title}</b>
        <dl className="tr-defs">
          <dt>When</dt>
          <dd>{saved.lesson.when}</dd>
          <dt>Do</dt>
          <dd>{saved.lesson.do}</dd>
          {saved.lesson.avoid && (
            <>
              <dt>Avoid</dt>
              <dd>{saved.lesson.avoid}</dd>
            </>
          )}
        </dl>
        <p className="small dim" style={{ marginTop: 10 }}>
          {saved.sent_to_hub ? "Sent to the other sites." : "Kept at this site: no hub is connected."}
          {saved.alert && ` ${saved.alert}`}
        </p>
      </Card>
    );
  }

  return (
    <Card title="What was found" icon={<ClipboardList size={15} />} sub="after the repair">
      <div className="col gap-3">
        <textarea className="textarea" placeholder="What the technician found when the machine was opened." value={found} onChange={(e) => setFound(e.target.value)} aria-label="What was found" />
        <div className="field">
          <span className="label">Was Crux right?</span>
          <Seg
            value={right}
            onChange={setRight}
            block
            options={[
              { id: "yes", label: "Yes" },
              { id: "no", label: "No" },
            ]}
            label="Was Crux right"
          />
        </div>
        {hub && (
          <label className="row small">
            <input type="checkbox" checked={major} onChange={(e) => setMajor(e.target.checked)} /> Major failure: warn the other sites now
          </label>
        )}
        <input className="input" placeholder="Your name" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Your name" />
        <Button block busy={busy} disabled={!found.trim() || !by.trim()} onClick={send}>
          Record outcome
        </Button>
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
    </Card>
  );
}
