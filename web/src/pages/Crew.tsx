// To do: a technician's inbox. One row per job, most urgent first, each with
// one thing to do: the measurement Crux is waiting for, a repair that is
// approved, a repair whose check did not pass, a work order to carry out, a
// machine with no sensor whose turn it is to be scanned.

import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ClipboardList, Cpu, Crosshair, ListTodo, RotateCcw, ScanLine, Timer, Wrench } from "lucide-react";
import type { FaultKind, RunParams } from "../api/types";
import { usePresence } from "../lib/glide";
import { useCatalogue } from "../lib/hooks";
import { answerWithInstrument } from "../lib/instrument";
import { check, fault } from "../lib/plain";
import { SITE, machineOfCase, standingOf } from "../lib/plant";
import { isOnList } from "../lib/scenarios";
import { markAnswered, rememberInvestigation } from "../lib/session";
import { usePlant } from "../lib/useplant";
import { Button, Callout, Card, CountUp, Details, Empty, Hint, LinkButton, PageHead, cx, toast } from "../ui/kit";
import { rowsOf, type CaseRow } from "./parts";
import "../styles/plant.css";
import "./pages.css";

type Job = { key: string; tone: "warn" | "danger" | "neutral"; icon: ReactNode; title: ReactNode; meta: ReactNode; act: ReactNode; more?: ReactNode };

export default function Crew() {
  const { session, rows, tickets } = usePlant();
  const catalogue = useCatalogue();
  const cases = rowsOf(session.cases);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const found = (r: CaseRow) => r.model.status === "concluded" && !!r.model.leader && r.model.leader.kind !== "healthy";
  const measure = cases.filter((r) => r.model.status === "waiting");
  const repairs = cases.filter((r) => found(r) && r.entry.approved && !r.entry.repair);
  const recheck = cases.filter((r) => r.entry.repair && r.entry.repair.result.outcome !== "verified");
  const coming = cases.filter((r) => found(r) && !r.entry.approved);
  const orders = (tickets.data ?? []).filter((t) => t.status === "approved");
  const scans = rows.filter((r) => r.m.mode === "camera");

  async function take(r: CaseRow) {
    setBusy(r.entry.id);
    setError(null);
    try {
      const test = r.model.checks.find((c) => c.status === "waiting")?.testId;
      const out = await answerWithInstrument(r.entry.id, r.entry.params as RunParams & { fault: FaultKind });
      rememberInvestigation(out.inv);
      if (!out.already && out.value !== undefined && test) markAnswered(r.entry.id, test, "virtual instrument", "here", out.value);
      toast(out.already ? "Already answered elsewhere." : `Reading sent. Crux carries on with ${machineOfCase(r.entry).short}.`, out.already ? "accent" : "ok");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const jobs: Job[] = [
    ...recheck.map((r) => ({
      key: r.entry.id,
      tone: "danger" as const,
      icon: <RotateCcw size={15} />,
      title: <Link to={`/cases/${r.entry.id}?tab=after`}>{fault(r.model.leader!.kind).name}</Link>,
      meta: `${machineOfCase(r.entry).name} · check after repair: ${r.entry.repair!.result.outcome.replace(/_/g, " ")}`,
      act: (
        <LinkButton to={`/cases/${r.entry.id}?tab=after`} size="sm" variant="primary">
          Check repair
        </LinkButton>
      ),
    })),
    ...measure.map((r) => {
      const w = r.model.checks.find((c) => c.status === "waiting");
      const cat = catalogue.data?.find((t) => t.id === w?.testId);
      const to = `/cases/${r.entry.id}?tab=summary`;
      const model = isOnList(r.entry.params.fault) && !r.entry.lost;
      return {
        key: r.entry.id,
        tone: "warn" as const,
        icon: <Crosshair size={15} />,
        title: <Link to={to}>{w ? check(w.testId).name : "A measurement"}</Link>,
        meta: [machineOfCase(r.entry).name, cat && `${cat.effort_min} min`, cat && (cat.downtime === "none" ? "keeps running" : cat.downtime)].filter(Boolean).join(" · "),
        act: model ? (
          <>
            <Button size="sm" variant="primary" icon={<Cpu size={13} />} busy={busy === r.entry.id} disabled={busy !== null} onClick={() => take(r)} title="The machine is a model: its virtual instrument takes the reading">
              Take model reading
            </Button>
            <LinkButton to={to} size="sm" variant="ghost">
              Open
            </LinkButton>
          </>
        ) : (
          <LinkButton to={to} size="sm" variant="primary">
            Take measurement
          </LinkButton>
        ),
        more: cat && (
          <Details summary="Steps">
            <ol>
              {cat.procedure.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ol>
          </Details>
        ),
      };
    }),
    ...repairs.map((r) => ({
      key: r.entry.id,
      tone: "warn" as const,
      icon: <Wrench size={15} />,
      title: <Link to={`/cases/${r.entry.id}?tab=after`}>{fault(r.model.leader!.kind).name}</Link>,
      meta: `${machineOfCase(r.entry).name} · approved by ${r.entry.approved?.by}`,
      act: (
        <LinkButton to={`/cases/${r.entry.id}?tab=after`} size="sm" variant="primary">
          Record repair
        </LinkButton>
      ),
    })),
    ...orders.map((t) => ({
      key: t.id,
      tone: "neutral" as const,
      icon: <ClipboardList size={15} />,
      title: <Link to={`/work-orders/${t.id}`}>{t.part_label}</Link>,
      meta: `${t.machine_name} · work order ${t.id}, approved by ${t.approved_by}`,
      act: (
        <LinkButton to={`/work-orders/${t.id}`} size="sm" variant="primary">
          Open work order
        </LinkButton>
      ),
    })),
    ...scans
      .filter(({ st }) => standingOf(st) === "person" && st.next)
      .map(({ m, st }) => ({
        key: m.id,
        tone: "warn" as const,
        icon: <ScanLine size={15} />,
        title: <Link to={st.next!.to}>{st.label}</Link>,
        meta: m.name,
        act: (
          <LinkButton to={st.next!.to} size="sm" variant="primary">
            {st.next!.label}
          </LinkButton>
        ),
      })),
  ];
  const shown = usePresence(jobs, (j) => j.key);

  return (
    <div className="page">
      <PageHead eyebrow={`${SITE.name} · for the maintenance crew`} title="To do" sub={jobs.length ? "Most urgent first." : "Measurements and repairs Crux needs appear here."} />

      {error && <Callout tone="danger">{error}</Callout>}

      <div className="col narrow" style={{ gap: "var(--s-4)" }}>
        <Card title="To do" icon={<ListTodo size={15} />} sub={jobs.length > 0 ? <CountUp value={jobs.length} /> : undefined} flush tone={jobs.length ? "warn" : undefined}>
          {shown.length === 0 ? (
            <Empty left title="Nothing to do" action={session.cases.length === 0 ? <LinkButton to="/go/shift" size="sm">Start a shift</LinkButton> : <LinkButton to="/plant" size="sm">Open the control room</LinkButton>}>
              Measurements and repairs Crux needs appear here.
            </Empty>
          ) : (
            <ul className="inbox" data-tour="crew-todo">
              {shown.map(({ item: j, key, leaving }) => (
                <li key={key} className={cx("job", leaving && "leaving")}>
                  <div className="job-in">
                    <span className={cx("job-icon", `tone-${j.tone}`)} aria-hidden>
                      {j.icon}
                    </span>
                    <div>
                      <h3>{j.title}</h3>
                      <div className="job-meta">{j.meta}</div>
                      {j.more}
                    </div>
                    <div className="job-acts">{j.act}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {coming.length > 0 && (
          <Card title="Next, once approved" icon={<Timer size={15} />} sub={coming.length} flush>
            <ul className="quiet-list">
              {coming.map((r) => (
                <li key={r.entry.id}>
                  <div className="grow">
                    <Link to={`/cases/${r.entry.id}`} className="strong">
                      {fault(r.model.leader!.kind).name}
                    </Link>
                    <small>{machineOfCase(r.entry).name}</small>
                  </div>
                  <span className="owner manager">Manager</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <p className="foot-note">
          Crux never sends a command to a machine.
          <Hint label="How a job reaches you">
            Crux investigates each reading. If it cannot tell two causes apart, it asks you for one measurement. When it names a cause, a manager approves the work; after your repair, a new reading checks it.
          </Hint>
        </p>
      </div>
    </div>
  );
}
