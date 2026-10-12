// One case, whole: where it stands, the measurement it asked for, every
// suspect, the signal, the evidence, who did the work, and what happened after.

import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Bot, ChevronRight, CircleCheck, CircleHelp, ClipboardCheck, Cpu, FolderSearch, Hourglass, LoaderCircle, Scale, ServerCrash, ShieldAlert } from "lucide-react";
import { report as fetchReport } from "../api/crux";
import { runBrain } from "../lib/ai";
import { STATUS_LABEL, STATUS_TONE, modelOf, type CaseStatus } from "../lib/casemodel";
import { clock, pct, shortId, stamp } from "../lib/format";
import { useAbout, useAsync, useCatalogue, useLiveCase } from "../lib/hooks";
import { fault } from "../lib/plain";
import { PUMP, isOnList, scenario } from "../lib/scenarios";
import { patchCase, useCaseEntry, type CaseEntry } from "../lib/session";
import { Badge, Button, Callout, Card, Empty, LinkButton, SourceTag, Stat, cx } from "../ui/kit";
import { DecisionCard, Menu } from "./case/Decision";
import { LedgerCard } from "./case/Ledger";
import { ChecksCard, MemoryCard, NotesCard, RunCard } from "./case/Rail";
import { RepairCard } from "./case/RepairCard";
import { ReportCard } from "./case/ReportCard";
import { SignalCard } from "./case/Signal";
import { SuspectsCard } from "./case/Suspects";
import { AgentTrace, EngineLog } from "./case/Trace";
import { VerdictCard } from "./case/Verdict";
import "./pages.css";

const STATUS_ICON: Record<CaseStatus, React.ReactNode> = {
  waiting: <Hourglass size={15} />,
  open: <LoaderCircle size={15} className="spin" />,
  concluded: <CircleCheck size={15} />,
  unresolved: <CircleHelp size={15} />,
};

/** Keyed by the case, so nothing read for one case is ever shown on another. */
export default function CasePage() {
  const { id } = useParams();
  return <Case key={id} id={id} />;
}

function Case({ id }: { id: string | undefined }) {
  const entry = useCaseEntry(id);
  const catalogue = useCatalogue();
  const about = useAbout();
  const [picked, setPicked] = useState<string | null>(null);
  const [cited, setCited] = useState<string[]>([]);

  const model = useMemo(() => modelOf(entry, catalogue.data), [entry, catalogue.data]);
  useLiveCase(id, entry?.kind === "engine", model?.status === "waiting");

  const closed = model?.status === "concluded" || model?.status === "unresolved";
  const notes = model?.notes.length ?? 0;
  const rep = useAsync(() => (closed && id && !entry?.lost ? fetchReport(id) : Promise.resolve(null)), [id, closed, entry?.lost, notes]);

  if (!entry || !model) {
    return (
      <div className="page">
        <Card>
          <Empty icon={<FolderSearch size={18} />} title="This case is not in this browser's session" action={<LinkButton to="/cases">All cases</LinkButton>}>
            Each browser keeps the cases it opened. A case opened somewhere else, or before the session was reset, is not listed here.
          </Empty>
        </Card>
      </div>
    );
  }

  const leader = model.leader;
  const defaultPick = leader && isOnList(leader.kind) ? leader.kind : "healthy";
  const shown = picked ?? defaultPick;
  const conclusion = entry.inv?.conclusion ?? null;
  const sc = scenario(entry.scenario);
  const brain = entry.run ? runBrain(entry.run.model, entry.run.live) : null;
  const answered = model.checks.filter((c) => c.status === "answered").length;
  const faultNamed = model.status === "concluded" && leader && leader.kind !== "healthy";
  const noTest = entry.inv?.no_test ?? null;

  return (
    <div className="page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/cases">Cases</Link>
        <ChevronRight size={12} aria-hidden />
        <span className="mono">Case {shortId(entry.id)}</span>
      </nav>

      <header className="case-head">
        <div className="grow">
          <h1>{PUMP.name}</h1>
          <div className="case-meta">
            <span className="mono">Case {shortId(entry.id)}</span>
            <SourceTag source={PUMP.source} />
            {entry.kind === "agents" ? (
              <Badge tone="model" dot>
                agents · {brain?.name}
              </Badge>
            ) : (
              <Badge tone="accent" dot>
                engine, with a person
              </Badge>
            )}
            <span>opened {stamp(entry.createdAt)}</span>
            {sc && <span className="dim">· scenario “{sc.title}”</span>}
            {entry.batch && <span className="dim">· part of an autonomous run</span>}
          </div>
        </div>
        <span className={cx("status-lg", `tone-${STATUS_TONE[model.status]}`)}>
          {STATUS_ICON[model.status]}
          {STATUS_LABEL[model.status]}
        </span>
      </header>

      {entry.lost && (
        <Callout tone="warn" icon={<ServerCrash size={15} />}>
          The server no longer holds this case: it keeps cases in memory and has restarted since. What you see is the last state this browser read, and it cannot be changed.
        </Callout>
      )}
      {model.hazard && (
        <Callout tone="danger" icon={<ShieldAlert size={15} />}>
          <b>{model.hazard}</b>
          {entry.hazardAck && (
            <div className="small" style={{ marginTop: 4 }}>
              Acknowledged by {entry.hazardAck.by} at {clock(entry.hazardAck.at)} (recorded in this browser).
            </div>
          )}
        </Callout>
      )}

      <div className="stats">
        <Stat label="Leading suspect" value={<span style={{ fontSize: "1.25rem" }}>{leader ? fault(leader.kind).name : "–"}</span>} sub={leader ? <span className="mono">{fault(leader.kind).technical}</span> : undefined} />
        <Stat label="Belief" value={pct(leader?.belief)} sub={`a verdict needs ${pct(model.concludeAt)}`} />
        <Stat label="Evidence" value={model.ledger.length} unit="entries" sub={`${model.experiments} from virtual experiments`} />
        <Stat label="Measurements" value={`${answered}/${model.checks.length}`} sub={model.checks.length === 0 ? "none was needed" : "answered / asked for"} />
        <Stat
          label="Investigated by"
          icon={entry.kind === "agents" ? <Bot size={13} /> : <Cpu size={13} />}
          value={<span style={{ fontSize: "1.25rem" }}>{entry.kind === "agents" ? "Agents" : "Engine"}</span>}
          sub={entry.kind === "agents" ? `${entry.run?.tool_calls.length ?? 0} tool calls, ${entry.run?.rounds ?? 0} rounds` : "a person answers its requests"}
        />
      </div>

      <div className="split">
        <div className="col gap-4" style={{ gap: "var(--s-5)" }}>
          <VerdictCard model={model} conclusion={conclusion} report={rep.data} />
          <DecisionCard model={model} entry={entry} catalogue={catalogue.data} />
          {model.status === "unresolved" && noTest && noTest.considered.length > 0 && (
            <Card title="No measurement could settle it" icon={<Scale size={15} />}>
              <p className="muted">{noTest.reason}</p>
              <Menu considered={noTest.considered} />
            </Card>
          )}
          <SuspectsCard model={model} entry={entry} picked={shown} onPick={isOnList(entry.params.fault) ? setPicked : null} onCite={setCited} />
          <SignalCard model={model} entry={entry} picked={shown} />
          {closed && <ReportCard caseId={entry.id} report={rep.data} loading={rep.loading} lost={!!entry.lost} onCite={setCited} />}
          {faultNamed && <HandOff entry={entry} action={conclusion?.recommended_action ?? rep.data?.lines.find((l) => l.part === "action")?.text ?? null} />}
          {faultNamed && leader && <RepairCard entry={entry} cause={leader.kind} approvedBy={entry.approved?.by} />}
          <LedgerCard model={model} cited={cited} />
        </div>

        <aside className="col rail" style={{ gap: "var(--s-5)" }}>
          {entry.kind === "agents" && entry.run ? <AgentTrace run={entry.run} about={about.data} tookMs={entry.tookMs} id={entry.id} /> : <EngineLog transcript={model.transcript} />}
          {entry.kind === "agents" && <ChecksCard model={model} />}
          <MemoryCard model={model} />
          <NotesCard entry={entry} model={model} />
          <RunCard entry={entry} model={model} />
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
