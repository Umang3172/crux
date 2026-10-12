// One case, whole: where it stands in its pipeline, the agents at work on it,
// the machine it is about, the measurement it asked for, every suspect, the
// signal, the evidence, and what happened after.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Bot, ChevronRight, CircleCheck, CircleHelp, ClipboardCheck, Cog, Cpu, FastForward, FolderSearch, Hourglass, LoaderCircle, Scale, ServerCrash, ShieldAlert, Workflow } from "lucide-react";
import { report as fetchReport } from "../api/crux";
import type { AgentRun } from "../api/types";
import { runBrain } from "../lib/ai";
import { STATUS_LABEL, STATUS_TONE, modelOf, type CaseModel, type CaseStatus } from "../lib/casemodel";
import { clock, num, pct, shortId, stamp } from "../lib/format";
import { useAbout, useAsync, useCatalogue, useLiveCase, useMachineModel } from "../lib/hooks";
import { shownSteps, useLiveRun } from "../lib/liveruns";
import { fault } from "../lib/plain";
import { usePlayback } from "../lib/playback";
import { MODE, machineOfCase, machinePath } from "../lib/plant";
import { isOnList, scenario } from "../lib/scenarios";
import { patchCase, useCaseEntry, type CaseEntry } from "../lib/session";
import { AgentStage } from "../ui/AgentStage";
import { MachineTwin, type TwinFrequencies } from "../ui/MachineTwin";
import { Badge, Button, Callout, Card, Empty, LinkButton, SourceTag, Stat, cx } from "../ui/kit";
import { DecisionCard, Menu } from "./case/Decision";
import { LedgerCard } from "./case/Ledger";
import { PipelineCard } from "./case/Pipeline";
import { ChecksCard, MemoryCard, NotesCard, RunCard } from "./case/Rail";
import { RepairCard } from "./case/RepairCard";
import { ReportCard } from "./case/ReportCard";
import { SignalCard, type Band } from "./case/Signal";
import { SuspectsCard } from "./case/Suspects";
import { TheatreCard } from "./case/Theatre";
import { AgentTrace, EngineLog } from "./case/Trace";
import { VerdictCard } from "./case/Verdict";
import "../styles/viz.css";
import "./pages.css";

const STATUS_ICON: Record<CaseStatus, React.ReactNode> = {
  waiting: <Hourglass size={15} />,
  open: <LoaderCircle size={15} className="spin" />,
  concluded: <CircleCheck size={15} />,
  unresolved: <CircleHelp size={15} />,
};

const EMPTY_RUN: Pick<AgentRun, "tool_calls" | "model" | "live" | "rounds" | "fallback" | "stopped" | "thoughts"> = {
  tool_calls: [],
  model: "",
  live: false,
  rounds: 0,
  fallback: null,
  stopped: null,
  thoughts: [],
};

/** The frequencies the case's own ledger holds, for the machine drawing's readouts. */
function ledgerHz(model: CaseModel | null): TwinFrequencies {
  const find = (re: RegExp) => model?.ledger.find((l) => re.test(l.statement) && typeof l.value === "number")?.value as number | undefined;
  return { shaft: find(/shaft frequency \(1x\)/i), bpfo: find(/predicted BPFO/i), bpfi: find(/predicted BPFI/i) };
}

/** Keyed by the case, so nothing read for one case is ever shown on another. */
export default function CasePage() {
  const { id } = useParams();
  return <Case key={id} id={id} />;
}

function Case({ id }: { id: string | undefined }) {
  const entry = useCaseEntry(id);
  const catalogue = useCatalogue();
  const about = useAbout();
  const twin = useMachineModel();
  const live = useLiveRun(id);
  const [picked, setPicked] = useState<string | null>(null);
  const [cited, setCited] = useState<string[]>([]);
  const [band, setBand] = useState<Band>("envelope");

  const model = useMemo(() => modelOf(entry, catalogue.data), [entry, catalogue.data]);
  useLiveCase(id, entry?.kind === "engine", model?.status === "waiting");

  const isAgents = entry?.kind === "agents";
  const running = !!entry && isAgents && !entry.run && !entry.failed;
  const stuck = running && !live;
  const raw = entry?.run?.steps ?? live?.steps;
  const steps = useMemo(() => shownSteps(raw ?? []), [raw]);
  const streaming = running && !!live?.streaming;
  // Decided once, when the page opens: a run started just now is shown as it happens.
  const firstView = useRef(isAgents && (!!entry?.watch || running));
  const pb = usePlayback(steps, { streaming, autoplay: firstView.current, runKey: id ?? "" });
  const ended = pb.play.ended;
  const watching = firstView.current && !stuck && (running || !ended);

  useEffect(() => {
    // A run opened earlier is shown finished, ready to be replayed.
    if (!firstView.current) pb.finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (id && entry?.watch && ended) patchCase(id, { watch: false });
  }, [id, entry?.watch, ended]);

  const closed = model?.status === "concluded" || model?.status === "unresolved";
  const notes = model?.notes.length ?? 0;
  const rep = useAsync(() => (closed && id && !entry?.lost ? fetchReport(id) : Promise.resolve(null)), [id, closed, entry?.lost, notes]);

  if (!entry) {
    return (
      <div className="page">
        <Card>
          <Empty icon={<FolderSearch size={18} />} title="This investigation is not in this browser's session" action={<LinkButton to="/cases">All investigations</LinkButton>}>
            Each browser keeps the investigations it opened. One opened somewhere else, or before the session was reset, is not listed here.
          </Empty>
        </Card>
      </div>
    );
  }

  const sc = scenario(entry.scenario);
  const machineOn = machineOfCase(entry);
  const brain = entry.run ? runBrain(entry.run.model, entry.run.live) : null;
  const leader = model?.leader ?? null;
  const show = model && !watching ? model : null;
  const named = show?.status === "concluded" && leader ? fault(leader.kind).part : "none";

  const stage = isAgents && (
    <Card
      title={watching ? "Crux investigating" : "The investigation, replayed"}
      icon={<Workflow size={15} />}
      tone={watching ? "model" : undefined}
      sub={streaming ? "live" : entry.run ? `${entry.run.tool_calls.length} tool calls in ${entry.run.rounds} rounds` : undefined}
      actions={
        <>
          {brain && (
            <Badge tone={brain.live ? "ok" : "neutral"} dot title={entry.run?.model}>
              {brain.name}
            </Badge>
          )}
          {watching && !running && (
            <Button size="sm" icon={<FastForward size={13} />} onClick={pb.finish}>
              Skip to the result
            </Button>
          )}
        </>
      }
      foot={
        streaming
          ? "Live: each call is shown as the server reports it, and its answer when the tools give one."
          : watching
            ? `The run is over on the server${entry.tookMs ? ` (it took ${num(entry.tookMs / 1000, 1)} s)` : ""}. Its calls are shown here at reading speed; the result follows.`
            : "A record of the run. Every packet is one tool call it made; violet is a model's call, blue is the engine's answer."
      }
    >
      <AgentStage about={about.data} steps={steps} play={pb.play} streaming={streaming} experiments={model?.experiments} controls={streaming ? undefined : pb} />
    </Card>
  );

  const machine = twin.data && (
    <Card title={machineOn.name} icon={<Cog size={15} />} sub="its parts turning at their real ratios to the shaft" actions={<SourceTag source={MODE.model.source} />}>
      <MachineTwin model={twin.data} kind={machineOn.kind === "fan" ? "fan" : "pump"} rpm={model?.rpm ?? machineOn.rpm ?? twin.data.nominal_rpm} part={named} sensor={show?.status === "waiting" ? "asked" : "idle"} hz={ledgerHz(show)} />
      {named !== "none" && leader && (
        <p className="small muted" style={{ marginTop: 10 }}>
          The verdict names <b style={{ color: "var(--warn)" }}>{fault(leader.kind).partName}</b>. {fault(leader.kind).story}
        </p>
      )}
    </Card>
  );

  const head = (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/cases">Investigations</Link>
        <ChevronRight size={12} aria-hidden />
        <Link to={machinePath(machineOn)}>{machineOn.name}</Link>
        <ChevronRight size={12} aria-hidden />
        <span className="mono">{shortId(entry.id)}</span>
      </nav>
      <header className="case-head">
        <div className="grow">
          <h1>{machineOn.name}</h1>
          <div className="case-meta">
            <span className="mono">Investigation {shortId(entry.id)}</span>
            <SourceTag source={MODE.model.source} />
            {isAgents ? (
              <Badge tone="model" dot>
                Crux's AI{brain ? ` · ${brain.name}` : ""}
              </Badge>
            ) : (
              <Badge tone="accent" dot>
                engine, with a technician
              </Badge>
            )}
            <span>opened {stamp(entry.createdAt)}</span>
            {sc && <span className="dim">· guided: “{sc.title}”</span>}
            {entry.batch && <span className="dim">· from a simulated shift</span>}
          </div>
        </div>
        {show ? (
          <span className={cx("status-lg", `tone-${STATUS_TONE[show.status]}`)}>
            {STATUS_ICON[show.status]}
            {STATUS_LABEL[show.status]}
          </span>
        ) : (
          !stuck &&
          !entry.failed && (
            <span className="status-lg tone-accent">
              <LoaderCircle size={15} className="spin" />
              {running ? "Crux is investigating" : "Showing the investigation"}
            </span>
          )
        )}
      </header>
      {stuck && (
        <Callout tone="warn" icon={<ServerCrash size={15} />}>
          This investigation did not finish in this browser: the page was reloaded while Crux was working, and the server sends a run only once. Start it again from Investigate a machine.
        </Callout>
      )}
      {entry.failed && (
        <Callout tone="danger" icon={<ServerCrash size={15} />}>
          The run did not finish: {entry.failed}
        </Callout>
      )}
    </>
  );

  // While a run is being shown, the page holds back its result.
  if (!show) {
    return (
      <div className="page">
        {head}
        <PipelineCard model={null} entry={entry} />
        <div className="split">
          <div className="col" style={{ gap: "var(--s-5)" }}>
            {stage}
            {machine}
          </div>
          <aside className="col rail" style={{ gap: "var(--s-5)" }}>
            <AgentTrace run={{ ...EMPTY_RUN, ...(entry.run ?? {}), steps: raw ?? [] }} about={about.data} running upTo={pb.play.at} current={pb.play.at} />
          </aside>
        </div>
      </div>
    );
  }

  const defaultPick = leader && isOnList(leader.kind) ? leader.kind : "healthy";
  const shown = picked ?? defaultPick;
  const conclusion = entry.inv?.conclusion ?? null;
  const answered = show.checks.filter((c) => c.status === "answered").length;
  const faultNamed = show.status === "concluded" && leader && leader.kind !== "healthy";
  const noTest = entry.inv?.no_test ?? null;

  return (
    <div className="page">
      {head}

      {entry.lost && (
        <Callout tone="warn" icon={<ServerCrash size={15} />}>
          The server no longer holds this investigation: it keeps them in memory and has restarted since. What you see is the last state this browser read, and it cannot be changed.
        </Callout>
      )}
      {show.hazard && (
        <Callout tone="danger" icon={<ShieldAlert size={15} />}>
          <b>{show.hazard}</b>
          {entry.hazardAck && (
            <div className="small" style={{ marginTop: 4 }}>
              Acknowledged by {entry.hazardAck.by} at {clock(entry.hazardAck.at)} (recorded in this browser).
            </div>
          )}
        </Callout>
      )}

      <div className="stats">
        <Stat label="Leading suspect" value={<span style={{ fontSize: "1.25rem" }}>{leader ? fault(leader.kind).name : "–"}</span>} sub={leader ? <span className="mono">{fault(leader.kind).technical}</span> : undefined} />
        <Stat label="Belief" value={pct(leader?.belief)} sub={`a verdict needs ${pct(show.concludeAt)}`} />
        <Stat label="Evidence" value={show.ledger.length} unit="entries" sub={`${show.experiments} from virtual experiments`} />
        <Stat label="Measurements" value={`${answered}/${show.checks.length}`} sub={show.checks.length === 0 ? "none was needed" : "answered / asked for"} />
        <Stat
          label="Investigated by"
          icon={isAgents ? <Bot size={13} /> : <Cpu size={13} />}
          value={<span style={{ fontSize: "1.25rem" }}>{isAgents ? "Crux's AI" : "Engine"}</span>}
          sub={isAgents ? `${entry.run?.tool_calls.length ?? 0} tool calls, ${entry.run?.rounds ?? 0} rounds` : "a technician answers its requests"}
        />
      </div>

      <PipelineCard model={show} entry={entry} />

      <div className="split">
        <div className="col" style={{ gap: "var(--s-5)" }}>
          <VerdictCard model={show} conclusion={conclusion} report={rep.data} />
          <DecisionCard model={show} entry={entry} catalogue={catalogue.data} />
          {show.status === "unresolved" && noTest && noTest.considered.length > 0 && (
            <Card title="No measurement could settle it" icon={<Scale size={15} />}>
              <p className="muted">{noTest.reason}</p>
              <Menu considered={noTest.considered} />
            </Card>
          )}
          {stage}
          {machine}
          <TheatreCard model={show} entry={entry} band={band} picked={shown} onPick={setPicked} />
          <SuspectsCard model={show} entry={entry} picked={shown} onPick={isOnList(entry.params.fault) ? setPicked : null} onCite={setCited} />
          <SignalCard model={show} entry={entry} picked={shown} band={band} onBand={setBand} />
          {closed && <ReportCard caseId={entry.id} report={rep.data} loading={rep.loading} lost={!!entry.lost} onCite={setCited} />}
          {faultNamed && <HandOff entry={entry} action={conclusion?.recommended_action ?? rep.data?.lines.find((l) => l.part === "action")?.text ?? null} />}
          {faultNamed && leader && <RepairCard entry={entry} cause={leader.kind} approvedBy={entry.approved?.by} />}
          <LedgerCard model={show} cited={cited} />
        </div>

        <aside className="col rail" style={{ gap: "var(--s-5)" }}>
          {isAgents && entry.run ? <AgentTrace run={entry.run} about={about.data} tookMs={entry.tookMs} current={pb.play.playing || !ended ? pb.play.at : undefined} /> : <EngineLog transcript={show.transcript} machine={machineOn.short} />}
          {isAgents && <ChecksCard model={show} />}
          <MemoryCard model={show} />
          <NotesCard entry={entry} model={show} />
          <RunCard entry={entry} model={show} />
        </aside>
      </div>
    </div>
  );
}

/** The engine's recommendation becomes work only when a person puts their name to it. */
function HandOff({ entry, action }: { entry: CaseEntry; action: string | null }) {
  const [by, setBy] = useState("");
  if (!action) return null;
  return (
    <Card title="Hand-off" icon={<ClipboardCheck size={15} />} sub="Crux recommends; a person decides">
      <div className="row row-wrap between row-top">
        <div className="grow" style={{ minWidth: 260 }}>
          <div className="eyebrow">Recommended action</div>
          <p className="strong" style={{ marginTop: 4 }}>
            {action}
          </p>
          <p className="small dim" style={{ marginTop: 6 }}>
            Nothing in Crux sends a command to a machine. The approval is recorded in this browser; the server stores work orders only for forecast alarms.
          </p>
        </div>
        {entry.approved ? (
          <Badge tone="ok" dot>
            approved by {entry.approved.by} · {clock(entry.approved.at)}
          </Badge>
        ) : (
          <div className="row">
            <input className="input" style={{ width: 160 }} placeholder="Your name" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Your name, to approve the work" />
            <Button variant="primary" disabled={!by.trim()} onClick={() => patchCase(entry.id, { approved: { by: by.trim(), at: Date.now() } })}>
              Approve the work
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
