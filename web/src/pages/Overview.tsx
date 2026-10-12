// The console's first page: what came in, what the agents did with it, and
// what is waiting on a person.

import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Activity, ArrowRight, Bot, CircleCheck, CircleDashed, CircleHelp, CircleX, Eye, Factory, FastForward, FolderOpen, Hourglass, LoaderCircle, Play, Plus, Radio, Sparkles, Zap } from "lucide-react";
import { machines as fetchMachines, streamStatus, tickets as fetchTickets } from "../api/crux";
import { openLauncher } from "../app/Launcher";
import { clearBatch, skipBatchAnimation, startBatch, useBatch } from "../lib/autopilot";
import { modelOf } from "../lib/casemodel";
import { num, pct, shortId } from "../lib/format";
import { useAbout, useAsync, useMachineModel } from "../lib/hooks";
import { launchScenario } from "../lib/launch";
import { shownSteps, useLiveRun } from "../lib/liveruns";
import { usePlayback } from "../lib/playback";
import { fault, plainSentence } from "../lib/plain";
import { FAULT_SET, LIVE_SENSOR, PLANT_NAME, PUMP, SCENARIOS, type Scenario } from "../lib/scenarios";
import { patchCase, useSession } from "../lib/session";
import { AgentStage } from "../ui/AgentStage";
import { StackBar } from "../ui/charts";
import { MachineTwin } from "../ui/MachineTwin";
import { Badge, Button, Callout, Card, Empty, LinkButton, PageHead, SourceTag, Stat, cx } from "../ui/kit";
import { turnsOf } from "./case/Trace";
import { CaseTable, finding, rowsOf } from "./parts";
import "../styles/viz.css";
import "./pages.css";

export default function Overview() {
  const session = useSession();
  const rows = rowsOf(session.cases);
  const fleet = useAsync(() => fetchMachines(), []);
  const orders = useAsync(() => fetchTickets(), []);
  const sensor = useAsync(() => streamStatus(LIVE_SENSOR).catch(() => null), []);

  const named = rows.filter((r) => r.model.status === "concluded");
  const waiting = rows.filter((r) => r.model.status === "waiting");
  const declined = rows.filter((r) => r.model.status === "unresolved");
  const byAgents = rows.filter((r) => r.entry.kind === "agents" && r.model.status !== "waiting" && r.model.status !== "open");
  const toApprove = named.filter((r) => r.model.leader?.kind !== "healthy" && !r.entry.approved).length + (orders.data?.filter((t) => t.status === "draft").length ?? 0);

  return (
    <div className="page">
      <PageHead
        eyebrow={PLANT_NAME}
        title="Operations"
        sub="Problems come in, the agents investigate them on a physics model of the machine, and a person approves what happens next. Crux names a cause only when the evidence carries it."
        actions={
          <>
            <LinkButton to="/agents" icon={<Bot size={15} />}>
              How the agents work
            </LinkButton>
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => openLauncher()}>
              New case
            </Button>
          </>
        }
      />

      <div className="col gap-1">
        <div className="stats">
          <Stat label="Cases" icon={<FolderOpen size={13} />} value={rows.length} sub="opened in this browser's session" />
          <Stat label="Closed by the agents alone" icon={<Bot size={13} />} value={byAgents.length} sub="nobody answered a request" />
          <Stat label="Cause named" icon={<CircleCheck size={13} />} value={named.length} sub="belief passed the 80% bar" />
          <Stat label="No cause named" icon={<CircleHelp size={13} />} value={declined.length} sub="Crux declined rather than guess" />
          <Stat label="Waiting on a person" icon={<Hourglass size={13} />} value={waiting.length + toApprove} sub={`${waiting.length} measurement${waiting.length === 1 ? "" : "s"}, ${toApprove} approval${toApprove === 1 ? "" : "s"}`} />
        </div>
        {rows.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <StackBar
              height={6}
              parts={[
                { label: "Cause named", value: named.length, tone: "ok" },
                { label: "Waiting for a measurement", value: waiting.length, tone: "warn" },
                { label: "No cause named", value: declined.length, tone: "muted" },
              ]}
            />
          </div>
        )}
      </div>

      <div className="split-even">
        <div className="col" style={{ gap: "var(--s-5)" }}>
          <Card
            title="Case queue"
            icon={<FolderOpen size={15} />}
            sub={rows.length ? "newest first" : undefined}
            flush
            actions={
              rows.length > 0 && (
                <LinkButton to="/cases" size="sm" variant="ghost">
                  All cases <ArrowRight size={13} />
                </LinkButton>
              )
            }
          >
            {rows.length === 0 ? (
              <Empty
                icon={<FolderOpen size={18} />}
                title="No case yet"
                action={
                  <Button variant="primary" icon={<Zap size={14} />} onClick={() => void startBatch()}>
                    Start the autonomous run
                  </Button>
                }
              >
                Start a scenario below, send the fault set to the agents, or open a case of your own. Cases live in this browser's session.
              </Empty>
            ) : (
              <CaseTable rows={rows.slice(0, 8)} brief />
            )}
          </Card>

          <Scenarios />
          <Fleet fleet={fleet.data} sensor={sensor.data} activeCase={rows.find((r) => r.model.status === "waiting")?.entry.id} />
        </div>

        <div className="col" style={{ gap: "var(--s-5)" }}>
          <BatchCard />
          <ActivityFeed />
        </div>
      </div>
    </div>
  );
}

function Scenarios() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(s: Scenario) {
    setBusy(s.id);
    setError(null);
    try {
      navigate(`/cases/${await launchScenario(s)}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <Card title="Scenarios" icon={<Play size={15} />} sub="pinned settings: each replays the same run every time">
      <div className="grid-auto">
        {SCENARIOS.map((s) => (
          <button key={s.id} type="button" className="scenario" disabled={busy !== null} onClick={() => start(s)}>
            <div className="row between">
              <Badge tone={s.investigator === "agents" ? "model" : "accent"}>{s.shows}</Badge>
              {busy === s.id ? <LoaderCircle size={15} className="spin dim" /> : <ArrowRight size={15} className="dim" />}
            </div>
            <h3>{s.title}</h3>
            <p>{s.line}</p>
          </button>
        ))}
      </div>
      {error && (
        <div style={{ marginTop: 12 }}>
          <Callout tone="danger">{error}</Callout>
        </div>
      )}
    </Card>
  );
}

const ICON = {
  queued: <CircleDashed size={15} className="dim" />,
  running: <LoaderCircle size={15} className="spin t-accent" />,
  failed: <CircleX size={15} className="t-danger" />,
};

/** The fault set sent to the agents with nobody answering. */
function BatchCard() {
  const batch = useBatch();
  const session = useSession();
  const done = batch?.items.filter((i) => i.state === "done" || i.state === "failed").length ?? 0;
  const entries = (batch?.items ?? []).map((i) => session.cases.find((c) => c.id === i.caseId));
  // An incident is counted and named only once it has been shown.
  const models = entries.map((e, i) => (batch?.items[i].state === "done" ? modelOf(e) : null));
  const onStage = batch?.items.findIndex((i) => i.state === "running" || i.state === "showing") ?? -1;
  const revealed = entries.length > 0 && entries.every((e) => !e || e.revealed);
  const count = (st: string) => models.filter((m) => m?.status === st).length;
  const askedFirst = models.filter((m) => m && m.checks.length > 0).length;
  // The agents' own time: what each request took, not how long it was held on screen.
  const agentMs = entries.reduce((sum, e) => sum + (e?.tookMs ?? 0), 0);

  return (
    <Card
      title="Autonomous run"
      icon={<Zap size={15} />}
      tone={batch?.running ? "accent" : undefined}
      flush
      actions={
        batch && !batch.running ? (
          <Button size="sm" variant="ghost" onClick={clearBatch}>
            Clear
          </Button>
        ) : batch && !batch.skip ? (
          <Button size="sm" variant="ghost" icon={<FastForward size={13} />} onClick={skipBatchAnimation}>
            Skip the animation
          </Button>
        ) : undefined
      }
    >
      {!batch ? (
        <div className="col gap-3" style={{ padding: 16 }}>
          <p className="muted">
            Sends {FAULT_SET.length} synthetic faults to the agents one after another, with nobody answering: one of each kind the pump model can be given, including three that are not on the engine's list. The queue fills with what each run ended as.
          </p>
          <div className="row row-wrap">
            <Button variant="primary" icon={<Zap size={14} />} onClick={() => void startBatch()}>
              Run the fault set
            </Button>
            <SourceTag source="physics model · synthetic" />
          </div>
          <p className="small dim">
            When the agents ask for a measurement, the pump model's own instrument answers. What was fed in stays hidden until you reveal it, and no accuracy figure is drawn from these nine runs.
          </p>
        </div>
      ) : (
        <>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
            <div className="row between small" style={{ marginBottom: 6 }}>
              <span className="muted">{batch.running ? `Investigating ${Math.min(done + 1, batch.items.length)} of ${batch.items.length}…` : `${batch.items.length} incidents · ${num(agentMs / 1000, 1)} s of agent time`}</span>
              {!batch.running && (
                <span className="dim">
                  {count("concluded")} named a cause · {askedFirst} asked for a measurement first · {count("unresolved")} closed without one
                </span>
              )}
            </div>
            <StackBar
              height={6}
              parts={[
                { label: "Cause named", value: count("concluded"), tone: "ok" },
                { label: "No cause named", value: count("unresolved"), tone: "muted" },
                { label: "Still to run", value: batch.items.length - done, tone: "accent" },
              ]}
            />
          </div>
          {batch.running && onStage >= 0 && !batch.skip && (
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
              <div className="row between small" style={{ marginBottom: 6 }}>
                <b>
                  Incident {onStage + 1} of {batch.items.length}
                </b>
                <span className="dim">{batch.items[onStage].state === "running" ? "the agents have it" : "its calls, as they were made"}</span>
              </div>
              <BatchStage key={`${batch.id}:${onStage}`} caseId={batch.items[onStage].caseId} />
              <p className="small dim" style={{ marginTop: 8 }}>
                On the offline stand-in a run is over in a fraction of a second, so each one is held on screen long enough to follow. Skipping drops the wait, never a run.
              </p>
            </div>
          )}
          {batch.items.map((it, i) => {
            const e = entries[i];
            const m = models[i];
            return (
              <div className="batch-row" key={i}>
                {it.state === "done" && m ? m.status === "concluded" ? <CircleCheck size={15} className="t-ok" /> : <CircleHelp size={15} className="dim" /> : ICON[(it.state === "showing" ? "running" : it.state) as keyof typeof ICON]}
                <div className="col gap-1" style={{ gap: 1 }}>
                  <span className={cx(it.state === "queued" && "dim")}>
                    <span className="mono dim">#{i + 1}</span>{" "}
                    {it.state === "queued" && "queued"}
                    {(it.state === "running" || it.state === "showing") && "the agents are on it"}
                    {it.state === "failed" && <span className="t-danger">{it.error}</span>}
                    {m && (
                      <>
                        <b>{finding(m)}</b>
                        {m.status === "concluded" && <span className="dim num"> · {pct(m.leader?.belief)}</span>}
                        {m.leader?.origin === "written" && m.status === "concluded" && <span className="t-model"> · written by the critic</span>}
                        {m.checks.length > 0 && <span className="dim"> · asked for a measurement</span>}
                      </>
                    )}
                  </span>
                  {e?.revealed && <span className="small dim">fed in: {fault(it.params.fault).name.toLowerCase()}</span>}
                </div>
                {it.caseId && it.state === "done" ? (
                  <Link to={`/cases/${it.caseId}`} className="small mono">
                    {shortId(it.caseId)}
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
          {!batch.running && (
            <div className="row row-wrap" style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
              {!revealed && (
                <Button size="sm" icon={<Eye size={13} />} onClick={() => entries.forEach((e) => e && patchCase(e.id, { revealed: true }))}>
                  Reveal what was fed in
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={<Zap size={13} />} onClick={() => void startBatch()}>
                Run it again
              </Button>
              <span className="small dim" style={{ flexBasis: "100%" }}>
                Pinned synthetic runs: a demonstration, not a score. The measured results are under Proof.
              </span>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/** The incident the agents are on, drawn call by call. */
function BatchStage({ caseId }: { caseId: string | undefined }) {
  const about = useAbout();
  const live = useLiveRun(caseId);
  const steps = shownSteps(live?.steps ?? []);
  const streaming = !live || live.streaming;
  const pb = usePlayback(steps, { streaming, quick: true, autoplay: true, runKey: caseId ?? "none" });
  return <AgentStage about={about.data} steps={steps} play={pb.play} streaming={streaming} compact />;
}

/** The agents' latest tool calls across this session's runs. */
function ActivityFeed() {
  const session = useSession();
  const calls = [...session.cases]
    .filter((c) => c.kind === "agents" && c.run)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5)
    .flatMap((c) =>
      turnsOf(c.run!)
        .flatMap((t) => t.calls)
        // Re-reading the case and narrating are not decisions; the feed shows the calls that moved the case.
        .filter((s) => s.kind === "asks" && s.tool !== "get_case")
        .slice(-3)
        .reverse()
        .map((s) => ({ ...s, caseId: c.id })),
    )
    .slice(0, 12);

  return (
    <Card title="Agent activity" icon={<Activity size={15} />} sub="latest tool calls" flush>
      {calls.length === 0 ? (
        <Empty left icon={<Sparkles size={18} />} title="The agents have not run yet">
          Every tool call an agent makes shows up here, with the physics' answer to it.
        </Empty>
      ) : (
        <ul className="feed">
          {calls.map((s, i) => (
            <li key={i}>
              <span className={cx("feed-dot", s.agent)} aria-hidden />
              <div>
                <div className="row gap-1 row-wrap small">
                  <b className={s.agent === "critic" ? "t-model" : "t-accent"}>{s.agent}</b>
                  <code>{s.tool}</code>
                  <Link to={`/cases/${s.caseId}`} className="push mono dim">
                    {shortId(s.caseId)}
                  </Link>
                </div>
                <div className="muted small" style={{ marginTop: 2 }}>
                  {plainSentence(s.answered ?? s.asked)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Fleet({
  fleet,
  sensor,
  activeCase,
}: {
  fleet: Awaited<ReturnType<typeof fetchMachines>> | null;
  sensor: Awaited<ReturnType<typeof streamStatus>> | null;
  activeCase?: string;
}) {
  const twin = useMachineModel();
  return (
    <Card
      title="Machines"
      icon={<Factory size={15} />}
      flush
      actions={
        <LinkButton to="/machines" size="sm" variant="ghost">
          All machines <ArrowRight size={13} />
        </LinkButton>
      }
    >
      {twin.data && (
        <div style={{ padding: "12px 16px 14px", borderBottom: "1px solid var(--line)" }}>
          <div className="row between small" style={{ marginBottom: 2 }}>
            <b>{PUMP.name}, as the engine models it</b>
            <span className="dim">nominal speed</span>
          </div>
          <MachineTwin model={twin.data} rpm={twin.data.nominal_rpm} sensor={activeCase ? "asked" : "idle"} compact />
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Machine</th>
              <th>Watched by</th>
              <th>Now</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <b>{PUMP.name}</b>
                <div className="small dim">{PUMP.type}</div>
              </td>
              <td>
                <SourceTag source={PUMP.source} />
              </td>
              <td>
                {activeCase ? (
                  <Link to={`/cases/${activeCase}`}>
                    <Badge tone="warn" dot pulse>
                      waiting for a measurement
                    </Badge>
                  </Link>
                ) : (
                  <span className="dim">cases are opened by feeding it a fault</span>
                )}
              </td>
            </tr>
            {fleet?.machines.map((m) => (
              <tr key={m.machine}>
                <td>
                  <Link to={`/machines/${m.machine}`} className="strong">
                    {m.name}
                  </Link>
                  <div className="small dim">
                    {m.parts} part{m.parts === 1 ? "" : "s"} tracked over {num(m.end_h, 1)} h
                  </div>
                </td>
                <td>
                  <SourceTag source={fleet.synthetic ? "synthetic life · physics model" : "recorded run"} />
                </td>
                <td className="dim">a whole life, replayed</td>
              </tr>
            ))}
            <tr>
              <td>
                <b>Bench motor M-1</b>
                <div className="small dim">Live vibration sensor</div>
              </td>
              <td>
                <Badge plain>
                  <Radio size={11} /> live sensor
                </Badge>
              </td>
              <td>{sensor && sensor.seconds > 0 ? <Badge tone="ok" dot pulse>sending · {num(sensor.seconds, 0)} s buffered</Badge> : <span className="dim">no sensor is sending to this server</span>}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
