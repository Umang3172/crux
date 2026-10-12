// Maintenance: what a technician has to do. The measurements Crux is waiting
// for, the repairs that are approved, the checks after a repair, and the
// machines that can only be scanned.

import { useState } from "react";
import { Link } from "react-router";
import { ClipboardList, Cpu, Crosshair, ScanLine, Timer, Wrench } from "lucide-react";
import type { FaultKind, RunParams } from "../api/types";
import { useCatalogue } from "../lib/hooks";
import { answerWithInstrument } from "../lib/instrument";
import { check, fault } from "../lib/plain";
import { SITE, machineOfCase, machinePath } from "../lib/plant";
import { isOnList } from "../lib/scenarios";
import { markAnswered, rememberInvestigation } from "../lib/session";
import { usePlant } from "../lib/useplant";
import { Badge, Button, Callout, Card, Empty, LinkButton, PageHead, Stat } from "../ui/kit";
import { rowsOf, type CaseRow } from "./parts";
import "../styles/plant.css";
import "./pages.css";

export default function Crew() {
  const { session, rows, tickets } = usePlant();
  const catalogue = useCatalogue();
  const cases = rowsOf(session.cases);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const measure = cases.filter((r) => r.model.status === "waiting");
  const fixed = (r: CaseRow) => r.model.status === "concluded" && r.model.leader && r.model.leader.kind !== "healthy";
  const repairs = cases.filter((r) => fixed(r) && r.entry.approved && !r.entry.repair);
  const recheck = cases.filter((r) => r.entry.repair && r.entry.repair.result.outcome !== "verified");
  const coming = cases.filter((r) => fixed(r) && !r.entry.approved);
  const orders = (tickets.data ?? []).filter((t) => t.status === "approved");
  const scan = rows.filter((r) => r.m.mode === "camera");

  async function take(r: CaseRow) {
    setBusy(r.entry.id);
    setError(null);
    try {
      const test = r.model.checks.find((c) => c.status === "waiting")?.testId;
      const out = await answerWithInstrument(r.entry.id, r.entry.params as RunParams & { fault: FaultKind });
      rememberInvestigation(out.inv);
      if (!out.already && out.value !== undefined && test) markAnswered(r.entry.id, test, "virtual instrument", "here", out.value);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <PageHead eyebrow={`${SITE.name} · Maintenance`} title="My work" sub="What Crux needs from a technician: the one measurement it cannot take itself, the repairs a manager has approved, and a check after each repair to see whether it worked." />

      <div className="stats">
        <Stat label="Measurements to take" icon={<Crosshair size={13} />} value={measure.length} sub="Crux has stopped and is waiting" />
        <Stat label="Repairs to do" icon={<Wrench size={13} />} value={repairs.length + orders.length} sub="approved by a manager" />
        <Stat label="Repairs to look at again" value={recheck.length} sub="the check after the repair did not pass" />
        <Stat label="Coming, once approved" icon={<Timer size={13} />} value={coming.length} sub="faults found, waiting for a sign-off" />
      </div>

      {error && <Callout tone="danger">{error}</Callout>}

      <div className="split-even">
        <div className="col" style={{ gap: "var(--s-5)" }}>
          <Card title="Measurements Crux is asking for" icon={<Crosshair size={15} />} sub="it will not guess; one reading settles each" flush tone={measure.length ? "warn" : undefined}>
            {measure.length === 0 ? (
              <Empty left title="No measurement is waiting">
                When Crux cannot tell two causes apart, it asks for the single reading that separates them, and it appears here with its steps.
              </Empty>
            ) : (
              <ul className="todo">
                {measure.map((r) => {
                  const w = r.model.checks.find((c) => c.status === "waiting");
                  const cat = catalogue.data?.find((t) => t.id === w?.testId);
                  const m = machineOfCase(r.entry);
                  return (
                    <li key={r.entry.id}>
                      <div>
                        <h3>
                          {w ? check(w.testId).name : "A measurement"} <span className="muted">on {m.name}</span>
                        </h3>
                        <p>
                          {cat && (
                            <>
                              {cat.effort_min} min · {cat.downtime === "none" ? "the machine keeps running" : cat.downtime} ·{" "}
                            </>
                          )}
                          at {w ? check(w.testId).where : "the machine"}
                        </p>
                        {cat && <p style={{ marginTop: 4 }}>{cat.procedure.join(" · ")}</p>}
                      </div>
                      <div className="col" style={{ alignItems: "stretch" }}>
                        <LinkButton to={`/cases/${r.entry.id}`} variant="primary" size="sm">
                          Open the request
                        </LinkButton>
                        {isOnList(r.entry.params.fault) && !r.entry.lost && (
                          <Button size="sm" icon={<Cpu size={13} />} busy={busy === r.entry.id} disabled={busy !== null} onClick={() => take(r)} title="This machine is a model: its own instrument takes the reading">
                            Take it with the model's instrument
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Repairs to do" icon={<Wrench size={15} />} sub="approved; record the repair and Crux checks it" flush>
            {repairs.length + recheck.length + orders.length === 0 ? (
              <Empty left title="No repair is waiting">
                A repair comes here once a manager has put their name to it.
              </Empty>
            ) : (
              <ul className="todo">
                {[...recheck, ...repairs].map((r) => (
                  <li key={r.entry.id}>
                    <div>
                      <h3>
                        {fault(r.model.leader!.kind).name} <span className="muted">on {machineOfCase(r.entry).name}</span>
                      </h3>
                      <p>
                        {r.entry.repair ? <span className="t-danger">The check after the repair did not pass: {r.entry.repair.result.outcome.replace(/_/g, " ")}.</span> : <>Approved by {r.entry.approved?.by}. After the repair, take a new reading and Crux investigates it from scratch.</>}
                      </p>
                    </div>
                    <LinkButton to={`/cases/${r.entry.id}`} size="sm" variant="primary">
                      {r.entry.repair ? "Open the job" : "Record the repair"}
                    </LinkButton>
                  </li>
                ))}
                {orders.map((t) => (
                  <li key={t.id}>
                    <div>
                      <h3>
                        {t.part_label} <span className="muted">on {t.machine_name}</span>
                      </h3>
                      <p>Work order {t.id}, approved by {t.approved_by}. When it is done, record what was found.</p>
                    </div>
                    <LinkButton to={`/work-orders/${t.id}`} size="sm" variant="primary">
                      Open the work order
                    </LinkButton>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="col" style={{ gap: "var(--s-5)" }}>
          <Card title="Waiting for a sign-off" icon={<ClipboardList size={15} />} sub="not yours yet" flush>
            {coming.length === 0 ? (
              <Empty left title="Nothing is waiting for approval" />
            ) : (
              <ul className="list">
                {coming.map((r) => (
                  <li key={r.entry.id}>
                    <Link to={`/cases/${r.entry.id}`} className="strong">
                      {fault(r.model.leader!.kind).name}
                    </Link>
                    <div className="small muted">{machineOfCase(r.entry).name} · a manager has to approve the work first</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Machines with no sensor" icon={<ScanLine size={15} />} sub="a phone is the only reading" flush>
            <ul className="todo">
              {scan.map(({ m, st }) => (
                <li key={m.id}>
                  <div>
                    <h3>
                      <Link to={machinePath(m)} style={{ color: "inherit" }}>
                        {m.name}
                      </Link>
                    </h3>
                    <p>
                      {st.label}: {st.detail}
                    </p>
                  </div>
                  <LinkButton to={`/lens?machine=${encodeURIComponent(m.name)}`} size="sm" icon={<ScanLine size={13} />}>
                    Scan it
                  </LinkButton>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="How a job reaches you">
            <ol className="steps">
              <li>
                <span>Crux investigates a reading. If it cannot tell, it asks you for <b>one measurement</b>.</span>
              </li>
              <li>
                <span>When it names a cause, a <b>manager approves</b> the work. Nothing reaches you before that.</span>
              </li>
              <li>
                <span>You repair it, then take a new reading. Crux says whether the fault is <b>gone</b>.</span>
              </li>
            </ol>
            <div style={{ marginTop: 12 }}>
              <Badge plain>Crux never sends a command to a machine</Badge>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
