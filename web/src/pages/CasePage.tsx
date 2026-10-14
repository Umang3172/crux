// One investigation. The first screen answers three questions: what is wrong,
// how sure Crux is, and what happens next. The rest is one tab away, and the
// tab is in the address (?tab=summary|evidence|work|after) so it can be linked.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router";
import { Bot, ClipboardList, Cog, FileText, FlaskConical, FolderSearch, LayoutList, ServerCrash, ShieldAlert, Workflow } from "lucide-react";
import { report as fetchReport } from "../api/crux";
import type { AgentRun, MachineModel } from "../api/types";
import { runBrain } from "../lib/ai";
import { modelOf, type CaseModel } from "../lib/casemodel";
import { clock, signed } from "../lib/format";
import { useAbout, useAsync, useCatalogue, useLiveCase, useMachineModel, useReducedMotion } from "../lib/hooks";
import { shownSteps, useLiveRun } from "../lib/liveruns";
import { check, fault } from "../lib/plain";
import { usePlayback } from "../lib/playback";
import { MODE, machineOfCase, type PlantMachine } from "../lib/plant";
import { isOnList } from "../lib/scenarios";
import { patchCase, useCaseEntry } from "../lib/session";
import { AgentStage } from "../ui/AgentStage";
import { MachineTwin, type TwinFrequencies } from "../ui/MachineTwin";
import { Badge, Callout, Card, Empty, Hint, LinkButton, SourceTag, Tabs, toast, type Tone } from "../ui/kit";
import { DecisionCard, Menu, type AxisView } from "./case/Decision";
import { CaseHead, type Mode } from "./case/Head";
import { LedgerCard } from "./case/Ledger";
import { ApprovalCard, NextStep, type TabId } from "./case/NextStep";
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
import "../styles/case.css";

const TABS: TabId[] = ["summary", "evidence", "work", "after"];

const EMPTY_RUN: Pick<AgentRun, "tool_calls" | "model" | "live" | "rounds" | "fallback" | "stopped" | "thoughts"> = {
  tool_calls: [],
  model: "",
  live: false,
  rounds: 0,
  fallback: null,
  stopped: null,
  thoughts: [],
};

/** The frequencies the investigation's own ledger holds, for the machine drawing's readouts. */
function ledgerHz(model: CaseModel | null): TwinFrequencies {
  const find = (re: RegExp) => model?.ledger.find((l) => re.test(l.statement) && typeof l.value === "number")?.value as number | undefined;
  return { shaft: find(/shaft frequency \(1x\)/i), bpfo: find(/predicted BPFO/i), bpfi: find(/predicted BPFI/i) };
}

const beliefsOf = (m: CaseModel) => Object.fromEntries(m.suspects.map((s) => [s.kind, s.belief]));

/** The shell's hazard banners stick to the top too; the header sits below the tallest. */
function useBannerHeight(): number {
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const main = document.querySelector(".main");
    if (!main) return;
    const banners = () => Array.from(main.querySelectorAll<HTMLElement>(":scope > .banners"));
    const measure = () => setH(Math.max(0, ...banners().map((b) => b.offsetHeight)));
    const ro = new ResizeObserver(measure);
    const watch = () => {
      ro.disconnect();
      banners().forEach((b) => ro.observe(b));
      measure();
    };
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(main, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
  return h;
}

/** Keyed by the investigation, so nothing read for one is ever shown on another. */
export default function CasePage() {
  const { id } = useParams();
  return <Case key={id} id={id} />;
}

/** A reading has just been handed in: the page shows what it did, in order, before it settles. */
type Moment = { stage: 1 | 2 | 3; before: CaseModel };

function Case({ id }: { id: string | undefined }) {
  const entry = useCaseEntry(id);
  const catalogue = useCatalogue();
  const about = useAbout();
  const twin = useMachineModel();
  const live = useLiveRun(id);
  const reduced = useReducedMotion();
  const banner = useBannerHeight();
  const [search, setSearch] = useSearchParams();
  const asked = search.get("tab") as TabId | null;
  const tab: TabId = asked && TABS.includes(asked) ? asked : "summary";
  const [visited, setVisited] = useState<TabId[]>([tab]);
  const [anchor, setAnchor] = useState<string | null>(null);
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
  // The result is held back while a new run is shown; once shown, a replay no longer hides it.
  const [held, setHeld] = useState(firstView.current);
  const watching = held && !stuck && (running || !ended);

  useEffect(() => {
    // A run opened earlier is shown finished, ready to be replayed.
    if (!firstView.current) pb.finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (held && ended && !running) setHeld(false);
  }, [held, ended, running]);
  useEffect(() => {
    if (id && entry?.watch && ended) patchCase(id, { watch: false });
  }, [id, entry?.watch, ended]);
  useEffect(() => {
    if (!visited.includes(tab)) setVisited((v) => [...v, tab]);
  }, [tab, visited]);
  useEffect(() => {
    if (!anchor) return;
    const t = window.setTimeout(() => {
      document.getElementById(anchor)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      setAnchor(null);
    }, 60);
    return () => window.clearTimeout(t);
  }, [anchor, reduced, tab]);

  const show = model && !watching ? model : null;
  const closed = model?.status === "concluded" || model?.status === "unresolved";
  const notes = model?.notes.length ?? 0;
  const rep = useAsync(() => (closed && id && !entry?.lost ? fetchReport(id) : Promise.resolve(null)), [id, closed, entry?.lost, notes]);

  // The decisive moment: when a reading lands on a waiting investigation, the marker lands on
  // the axis, then the beliefs move, then the header and the next step settle. Laid out before
  // paint, so the new state never flashes ahead of its sequence.
  const readings = entry?.inv?.outcomes.length ?? 0;
  const prev = useRef<{ readings: number; model: CaseModel | null } | null>(null);
  const timers = useRef<number[]>([]);
  const [moment, setMoment] = useState<Moment | null>(null);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  useLayoutEffect(() => {
    const was = prev.current;
    prev.current = { readings, model: show };
    if (!was || !was.model || readings <= was.readings || was.model.status !== "waiting") return;
    const value = show?.checks.filter((c) => c.status === "answered").pop()?.reading;
    toast(
      value === null || value === undefined ? (
        "Reading handed in"
      ) : (
        <>
          Reading <b className="num">{signed(value, 2)}</b> handed in
        </>
      ),
      "accent",
    );
    if (reduced) return;
    timers.current.forEach((t) => window.clearTimeout(t));
    setMoment({ stage: 1, before: was.model });
    timers.current = [
      window.setTimeout(() => setMoment((m) => (m ? { ...m, stage: 2 } : m)), 320),
      window.setTimeout(() => setMoment((m) => (m ? { ...m, stage: 3 } : m)), 820),
      window.setTimeout(() => setMoment(null), 1400),
    ];
  }, [readings, show, reduced]);

  if (!entry) {
    return (
      <div className="page">
        <Card>
          <Empty icon={<FolderSearch size={18} />} title="Not in this browser" action={<LinkButton to="/cases">All investigations</LinkButton>}>
            Each browser keeps the investigations it opened.
          </Empty>
        </Card>
      </div>
    );
  }

  const go = (t: TabId, at?: string) => {
    setSearch(
      (p) => {
        const n = new URLSearchParams(p);
        n.set("tab", t);
        return n;
      },
      { replace: true },
    );
    if (at) setAnchor(at);
  };
  const cite = (ids: string[]) => {
    setCited(ids);
    go("evidence");
  };

  const machineOn = machineOfCase(entry);
  const mode: Mode = entry.failed ? "failed" : stuck ? "stuck" : watching ? (running ? "live" : "watching") : "result";
  const shown = moment && moment.stage < 3 ? moment.before : show;
  const conclusion = entry.inv?.conclusion ?? null;
  const action = conclusion?.recommended_action ?? rep.data?.lines.find((l) => l.part === "action" && l.by === "engine")?.text ?? null;
  const pageStyle = { "--case-banner": `${banner}px` } as CSSProperties;

  const head = <CaseHead entry={entry} model={shown} machine={machineOn} mode={mode} />;
  const brain = entry.run ? runBrain(entry.run.model, entry.run.live) : null;
  const brainBadge = brain && (
    <Badge tone={brain.live ? "ok" : "neutral"} dot title={entry.run?.model}>
      {brain.name}
    </Badge>
  );
  const next = (
    <NextStep
      entry={entry}
      model={shown}
      mode={mode}
      landing={moment && moment.stage < 3 ? { value: show?.checks.filter((c) => c.status === "answered").pop()?.reading ?? null } : null}
      action={action}
      catalogue={catalogue.data}
      machine={machineOn}
      onSkip={pb.finish}
      onGo={go}
    />
  );

  // While a run is being shown, the page holds back its result.
  if (!show) {
    return (
      <div className="page cp" style={pageStyle}>
        {head}
        {next}
        {(steps.length > 0 || mode === "live") && (
          <div className="cp-cols work">
            <Card title="Crux's AI at work" icon={<Workflow size={15} />} tone="model" className="cp-stage" actions={brainBadge}>
              <AgentStage about={about.data} steps={steps} play={pb.play} streaming={streaming} controls={streaming ? undefined : pb} />
              <StageKey />
            </Card>
            <AgentTrace run={{ ...EMPTY_RUN, ...(entry.run ?? {}), steps: raw ?? [] }} about={about.data} running={mode === "live"} upTo={pb.play.at} current={pb.play.at} />
          </div>
        )}
      </div>
    );
  }

  const leader = show.leader;
  const faultNamed = show.status === "concluded" && !!leader && leader.kind !== "healthy";
  const drawable = isOnList(entry.params.fault);
  const defaultPick = leader && isOnList(leader.kind) ? leader.kind : "healthy";
  const pick = picked ?? defaultPick;
  const noTest = entry.inv?.no_test ?? null;
  const hasAxis = !!show.lastRequest;
  const waitingAxis = hasAxis && shown?.status === "waiting";
  const n = entry.inv?.outcomes.length ?? 0;
  const before = entry.trail[n - 1];
  const axisView: AxisView | undefined = hasAxis
    ? moment && moment.stage < 2
      ? { beliefs: beliefsOf(moment.before), leader: moment.before.leader?.kind ?? null, settled: false, land: true }
      : {
          beliefs: beliefsOf(show),
          was: moment ? beliefsOf(moment.before) : before ? Object.fromEntries(before.map((b) => [b.kind, b.posterior])) : undefined,
          leader: show.leader?.kind ?? null,
          settled: shown?.status === "concluded",
          land: !!moment,
        }
    : undefined;

  const tabs: { id: TabId; label: string; icon: ReactNode; count?: number }[] = [
    { id: "summary", label: "Summary", icon: <LayoutList size={14} /> },
    { id: "evidence", label: "Evidence", icon: <FlaskConical size={14} />, count: show.ledger.length },
    { id: "work", label: "How Crux worked", icon: isAgents ? <Bot size={14} /> : <ClipboardList size={14} /> },
    { id: "after", label: "After", icon: <FileText size={14} /> },
  ];
  const panel = (t: TabId) => visited.includes(t) || t === tab;

  return (
    <div className="page cp" style={pageStyle}>
      {head}
      {entry.lost && (
        <Callout tone="warn" icon={<ServerCrash size={15} />}>
          The server no longer holds this investigation. This is the browser's last copy; it cannot change.
        </Callout>
      )}
      {show.hazard && (
        <div className="cp-hazard">
          <Callout tone="danger" icon={<ShieldAlert size={16} />}>
            <b>{show.hazard}</b>
            {entry.hazardAck && (
              <span className="small">
                {" "}
                · acknowledged by {entry.hazardAck.by} at {clock(entry.hazardAck.at)}, in this browser
              </span>
            )}
          </Callout>
        </div>
      )}
      {next}

      <Tabs value={tab} onChange={(t) => go(t)} tabs={tabs} label="Investigation" />

      {panel("summary") && (
        <section className="cp-panel" hidden={tab !== "summary"} aria-label="Summary">
          <div className="cp-cols summary">
            <div className="col cp-main">
              {hasAxis && <DecisionCard model={show} entry={entry} catalogue={catalogue.data} answer={false} view={axisView} />}
              {shown && !waitingAxis && <VerdictCard model={shown} conclusion={conclusion} report={rep.data} className={moment ? "enter" : undefined} />}
              {show.status === "unresolved" && noTest && noTest.considered.length > 0 && (
                <Card title="No measurement could settle it" icon={<FlaskConical size={15} />}>
                  <p className="muted">{noTest.reason}</p>
                  <Menu considered={noTest.considered} bare />
                </Card>
              )}
              {isAgents && show.checks.length > 0 && <ChecksCard model={show} />}
            </div>
            <aside className="col cp-side">{twin.data && <MachineCard twin={twin.data} machine={machineOn} model={shown} />}</aside>
          </div>
        </section>
      )}

      {panel("evidence") && (
        <section className="cp-panel" hidden={tab !== "evidence"} aria-label="Evidence">
          <div className={drawable ? "cp-cols evidence" : "cp-stack"}>
            <SuspectsCard model={show} entry={entry} picked={pick} onPick={drawable ? setPicked : null} onCite={(ids) => setCited(ids)} />
            {drawable && <TheatreCard model={show} entry={entry} band={band} picked={pick} onPick={setPicked} />}
          </div>
          {drawable && <SignalCard model={show} entry={entry} picked={pick} band={band} onBand={setBand} />}
          <LedgerCard model={show} cited={cited} />
        </section>
      )}

      {panel("work") && (
        <section className="cp-panel" hidden={tab !== "work"} aria-label="How Crux worked">
          {isAgents && entry.run ? (
            <div className="cp-cols work">
              <Card title="Crux's AI, call by call" icon={<Workflow size={15} />} className="cp-stage" actions={brainBadge}>
                <AgentStage about={about.data} steps={steps} play={pb.play} streaming={false} experiments={show.experiments} controls={pb} />
                <StageKey />
              </Card>
              <AgentTrace run={entry.run} about={about.data} tookMs={entry.tookMs} current={pb.play.playing || !pb.play.ended ? pb.play.at : undefined} />
            </div>
          ) : (
            <div className="cp-cols work engine">
              <EngineLog transcript={show.transcript} machine={machineOn.short} />
              <ChecksCard model={show} />
            </div>
          )}
        </section>
      )}

      {panel("after") && (
        <section className="cp-panel" hidden={tab !== "after"} aria-label="After">
          <div className="cp-cols after">
            <div className="col cp-main">
              {closed ? (
                <ReportCard caseId={entry.id} report={rep.data} loading={rep.loading} lost={!!entry.lost} onCite={cite} />
              ) : (
                <Card title="Report" icon={<FileText size={15} />}>
                  <Empty left title="No report yet">
                    It is written when the investigation closes.
                  </Empty>
                </Card>
              )}
              {faultNamed && <ApprovalCard entry={entry} action={action} />}
              {faultNamed && leader && <RepairCard entry={entry} cause={leader.kind} approvedBy={entry.approved?.by} />}
            </div>
            <aside className="col cp-side">
              <NotesCard entry={entry} model={show} />
              <MemoryCard model={show} />
              <RunCard entry={entry} model={show} />
            </aside>
          </div>
        </section>
      )}
    </div>
  );
}

/** What the colours on the stage mean. */
function StageKey() {
  return (
    <div className="stage-key">
      <span>
        <i className="k-model" aria-hidden />
        Crux's AI asks
      </span>
      <span>
        <i className="k-engine" aria-hidden />
        the engine answers
      </span>
      <span>
        <i className="k-sim" aria-hidden />
        suspects simulated
      </span>
    </div>
  );
}

/** The machine, with the named part marked or the point to measure lit. */
function MachineCard({ twin, machine, model }: { twin: MachineModel; machine: PlantMachine; model: CaseModel | null }) {
  const named = model?.status === "concluded" && model.leader ? fault(model.leader.kind) : null;
  const part = named ? named.part : "none";
  const asked = model?.status === "waiting";
  const where = model?.request ? check(model.request.test_id).where : "";
  const tone: Tone = part !== "none" ? "warn" : asked ? "accent" : "neutral";
  return (
    <Card
      title="Machine"
      icon={<Cog size={15} />}
      className="cp-machine"
      actions={
        <>
          <SourceTag source={MODE.model.source} />
          <Hint label="About the drawing">A drawing of the engine's model. Its parts turn at their real ratios to the shaft.</Hint>
        </>
      }
    >
      <MachineTwin model={twin} kind={machine.kind === "fan" ? "fan" : "pump"} rpm={model?.rpm ?? machine.rpm ?? twin.nominal_rpm} part={part} sensor={asked ? "asked" : "idle"} hz={ledgerHz(model)} compact />
      {named && part !== "none" ? (
        <p className={`cp-machine-note t-${tone}`}>
          <b>{named.partName.replace(/^./, (c) => c.toUpperCase())}.</b> <span className="muted">{named.story}</span>
        </p>
      ) : asked && where ? (
        <p className="cp-machine-note t-accent">
          <b>Measure at {where}.</b>
        </p>
      ) : null}
    </Card>
  );
}

