// The plant: every machine, how it is looked after, where it stands and who
// has to act next. The control room's first page.

import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, BellRing, CircleCheck, CircleDashed, CircleHelp, CircleX, FastForward, Hourglass, LoaderCircle, Play, Plus, Radar, Smartphone, Sunrise } from "lucide-react";
import { openLauncher } from "../app/Launcher";
import { modelOf } from "../lib/casemodel";
import { num } from "../lib/format";
import { launchScenario } from "../lib/launch";
import { AREAS, MODE, OWNER, SITE, WORKFLOW, machineById, machinePath, type MachineStatus, type PlantMachine } from "../lib/plant";
import { SCENARIOS, type Scenario } from "../lib/scenarios";
import { useSession } from "../lib/session";
import { skipShiftAnimation, startShift, useShift, type ShiftItem } from "../lib/shift";
import { usePlant, type PlantRow } from "../lib/useplant";
import { MachineGlyph } from "../ui/MachineGlyph";
import { Badge, Button, Callout, Card, Empty, LinkButton, PageHead, SourceTag, Stat, cx } from "../ui/kit";
import { ActivityFeed, LiveCall, LiveStage } from "./live";
import { finding } from "./parts";
import "../styles/plant.css";
import "../styles/viz.css";
import "./pages.css";

/** Where a machine is along its own workflow. */
export function Flow({ m, st }: { m: PlantMachine; st: MachineStatus }) {
  const steps = WORKFLOW[m.mode];
  return (
    <div>
      <div className={cx("flow", st.tone !== "neutral" && `tone-${st.tone}`, st.busy && "busy")} role="img" aria-label={`Step ${Math.max(0, st.step) + 1} of ${steps.length}`}>
        {steps.map((s, i) => (
          <span key={s} className={i < st.step ? "done" : i === st.step ? "now" : undefined} />
        ))}
      </div>
      <div className="flow-label">
        <span>{MODE[m.mode].label}</span>
        <b>{st.step >= 0 ? steps[Math.min(st.step, steps.length - 1)] : "not started"}</b>
      </div>
    </div>
  );
}

function action(m: PlantMachine, st: MachineStatus): { label: string; to?: string; run?: () => void; primary?: boolean } | null {
  if (st.busy) return null;
  if (st.caseId && st.owner) return { label: st.owner === "crew" ? (st.step === 2 ? "Take the measurement" : "Open the job") : st.owner === "manager" ? "Review and approve" : "Open", to: `/cases/${st.caseId}`, primary: true };
  if (m.mode === "model") return { label: st.caseId ? "Investigate again" : "Investigate", run: () => openLauncher({ machine: m.id }) };
  if (m.mode === "camera") return { label: "Scan with a phone", to: `/lens?machine=${encodeURIComponent(m.name)}` };
  return { label: "Open", to: machinePath(m) };
}

function MachineTile({ row, item }: { row: PlantRow; item?: ShiftItem }) {
  const { m, st } = row;
  const act = action(m, st);
  // A modelled machine is running whenever nothing says otherwise; nothing is known of one with no sensor.
  const turning = m.mode === "model" && st.tone !== "danger";
  return (
    <article className={cx("tile", st.tone !== "neutral" && st.tone !== "ok" && `tone-${st.tone}`, st.busy && "busy")}>
      <div className="tile-top">
        <MachineGlyph kind={m.kind} rpm={m.rpm ?? 1798} running={turning} tone={st.busy ? "accent" : st.tone === "warn" || st.tone === "danger" ? st.tone : "neutral"} />
        <div className="tile-name">
          <Link to={machinePath(m)}>{m.name}</Link>
          <span>
            {m.type}
            {m.mode === "model" && <> · {num(m.rpm ?? 1798, 0)} rpm</>}
          </span>
        </div>
      </div>
      <div className="row row-wrap between">
        <Badge tone={st.tone} dot pulse={st.busy || st.owner === "crew"}>
          {st.label}
        </Badge>
        {st.owner && <span className={cx("owner", st.owner)}>{OWNER[st.owner]}</span>}
      </div>
      <p className="tile-detail">{st.busy && item?.reading?.by === "agents" ? <LiveCall key={item.caseId} caseId={item.caseId} /> : st.detail}</p>
      <Flow m={m} st={st} />
      <div className="tile-foot">
        <SourceTag source={MODE[m.mode].source} />
        {act &&
          (act.to ? (
            <LinkButton to={act.to} size="sm" variant={act.primary ? "primary" : "default"}>
              {act.label}
            </LinkButton>
          ) : (
            <Button size="sm" onClick={act.run}>
              {act.label}
            </Button>
          ))}
      </div>
    </article>
  );
}

export default function Plant() {
  const { rows, shift, machines } = usePlant();
  const by = (mode: string) => machines.filter((m) => m.mode === mode).length;
  const fine = rows.filter((r) => r.st.tone === "ok").length;
  const busy = rows.filter((r) => r.st.busy).length;
  const people = rows.filter((r) => r.st.owner && r.st.owner !== "crux").length;
  const unseen = rows.filter((r) => r.st.step < 0).length;
  const itemOf = (id: string) => shift?.items.find((i) => i.machine === id);

  return (
    <div className="page">
      <PageHead
        eyebrow={SITE.name}
        title="Plant"
        sub="Every machine on site, how it is looked after, and who has to act next. Crux investigates what it can on its own and stops for a person when the evidence cannot settle it."
        actions={
          <>
            <Button icon={<Sunrise size={15} />} onClick={() => void startShift()} disabled={shift?.running}>
              Simulate a shift
            </Button>
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => openLauncher()}>
              Investigate a machine
            </Button>
          </>
        }
      />

      <div className="stats">
        <Stat label="Machines" value={machines.length} sub={`${by("model")} modelled · ${by("life")} watched · ${by("live")} live · ${by("camera")} without a sensor`} />
        <Stat label="Running normally" icon={<CircleCheck size={13} />} value={fine} sub="checked, streaming or repaired and verified" />
        <Stat label="Crux is investigating" icon={<Radar size={13} />} value={busy} sub="its AI investigators are on them now" />
        <Stat label="Waiting on a person" icon={<Hourglass size={13} />} value={people} sub="a measurement, a repair or a sign-off" />
        <Stat label="Not looked at yet" icon={<CircleDashed size={13} />} value={unseen} sub="no reading investigated, or no sensor" />
      </div>

      <div className="split">
        <div className="col" style={{ gap: "var(--s-6)" }}>
          {AREAS.map((a) => {
            const here = rows.filter((r) => r.m.area === a.id);
            if (here.length === 0) return null;
            return (
              <section className="area" key={a.id}>
                <div className="area-head">
                  <h2>{a.name}</h2>
                  <span className="muted small">{a.line}</span>
                  <span className="area-count">
                    {here.length} machine{here.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="tiles">
                  {here.map((r) => (
                    <MachineTile key={r.m.id} row={r} item={itemOf(r.m.id)} />
                  ))}
                </div>
              </section>
            );
          })}
          <p className="small dim">
            {SITE.note} The modelled machines run on the engine's rotating-machine model, each at its own speed, and their readings are synthetic. A watched life comes from the server's own list; the phone-scan machines have nothing fitted.
          </p>
        </div>

        <aside className="col rail" style={{ gap: "var(--s-5)" }}>
          <Attention rows={rows} />
          <ShiftCard />
          <ActivityFeed />
          <Guided />
        </aside>
      </div>
    </div>
  );
}

/** What needs someone, soonest first. */
export function Attention({ rows, only }: { rows: PlantRow[]; only?: MachineStatus["owner"] }) {
  const list = rows.filter((r) => r.st.rank >= 4 && r.st.owner && r.st.owner !== "crux" && (!only || r.st.owner === only)).sort((a, b) => b.st.rank - a.st.rank);
  return (
    <Card title="Needs someone" icon={<BellRing size={15} />} sub={list.length ? `${list.length} machine${list.length === 1 ? "" : "s"}` : undefined} flush tone={list.some((r) => r.st.tone === "danger") ? "danger" : undefined}>
      {list.length === 0 ? (
        <Empty left icon={<CircleCheck size={18} />} title="Nothing is waiting on a person">
          When Crux needs a measurement, a repair or a sign-off, the machine is listed here with who has to act.
        </Empty>
      ) : (
        <ul className="list">
          {list.map(({ m, st }) => (
            <li key={m.id}>
              <div className="row between">
                <Link to={st.caseId ? `/cases/${st.caseId}` : machinePath(m)} className="strong">
                  {m.name}
                </Link>
                {st.owner && <span className={cx("owner", st.owner)}>{OWNER[st.owner]}</span>}
              </div>
              <div className="small" style={{ marginTop: 2 }}>
                <span className={st.tone === "danger" ? "t-danger" : "t-warn"}>{st.label}</span> <span className="muted">· {st.detail}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const STATE_ICON = {
  held: <Hourglass size={15} className="t-warn" />,
  queued: <CircleDashed size={15} className="dim" />,
  running: <LoaderCircle size={15} className="spin t-accent" />,
  showing: <LoaderCircle size={15} className="spin t-accent" />,
  failed: <CircleX size={15} className="t-danger" />,
};

/** A reading from every modelled machine at once, each investigated side by side. */
function ShiftCard() {
  const shift = useShift();
  const session = useSession();
  const onStage = shift?.items.find((i) => i.reading?.by === "agents" && (i.state === "running" || i.state === "showing"));
  const allHeld = !!shift && shift.items.every((i) => i.state === "held");
  return (
    <Card
      title="Simulate a shift"
      icon={<Sunrise size={15} />}
      tone={shift?.running ? "accent" : undefined}
      flush
      actions={
        shift?.running && !shift.skip ? (
          <Button size="sm" variant="ghost" icon={<FastForward size={13} />} onClick={skipShiftAnimation}>
            Skip the animation
          </Button>
        ) : undefined
      }
    >
      {!shift ? (
        <div className="col gap-3" style={{ padding: 16 }}>
          <p className="muted">A reading comes in from every modelled machine at once. Crux investigates them side by side: its AI investigators close what the evidence settles, and where it cannot tell it stops and asks a technician for one measurement.</p>
          <div className="row row-wrap">
            <Button variant="primary" icon={<Sunrise size={14} />} onClick={() => void startShift()}>
              Start the shift
            </Button>
            <SourceTag source="synthetic readings" />
          </div>
          <p className="small dim">The faults fed in are pinned and hidden: open an investigation to reveal what its machine was given. A machine that is waiting on a person sends nothing new until they have acted. Nothing here is a score; the measured results are under Track record.</p>
        </div>
      ) : (
        <>
          {onStage && !shift.skip && (
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
              <div className="row between small" style={{ marginBottom: 6 }}>
                <b>On {machineById(onStage.machine)?.short}</b>
                <span className="dim">each call, as it was made</span>
              </div>
              <LiveStage key={onStage.caseId ?? onStage.machine} caseId={onStage.caseId} />
              <p className="small dim" style={{ marginTop: 8 }}>
                On the offline stand-in an investigation is over in a fraction of a second, so each is held on screen long enough to follow.
              </p>
            </div>
          )}
          {shift.items.map((it, i) => {
            const entry = session.cases.find((c) => c.id === it.caseId);
            const m = it.state === "done" ? modelOf(entry) : null;
            return (
              <div className="shift-row" key={i}>
                {it.state === "done" ? m?.status === "concluded" ? <CircleCheck size={15} className="t-ok" /> : m?.status === "waiting" ? <Hourglass size={15} className="t-warn" /> : <CircleHelp size={15} className="dim" /> : STATE_ICON[it.state]}
                <div className="col" style={{ gap: 1 }}>
                  <b className="small">{machineById(it.machine)?.name}</b>
                  <span className="small muted">
                    {it.state === "held" && `no new reading: still waiting on ${it.owner ? OWNER[it.owner].toLowerCase() : "a person"}`}
                    {it.state === "queued" && "a reading is coming in"}
                    {(it.state === "running" || it.state === "showing") && (it.reading?.by === "agents" ? "Crux's AI investigators have it" : "the engine is testing every suspect")}
                    {it.state === "failed" && <span className="t-danger">{it.error}</span>}
                    {m && finding(m)}
                  </span>
                </div>
                {it.caseId && it.state === "done" ? (
                  <Link to={`/cases/${it.caseId}`} className="small">
                    Open
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
          {!shift.running && (
            <div className="row row-wrap" style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
              <Button size="sm" icon={<Sunrise size={13} />} onClick={() => void startShift()}>
                Simulate the next shift
              </Button>
              <span className="small dim">
                {allHeld
                  ? "Every modelled machine is waiting on a person, so nothing new came in. View as Maintenance or Manager to move them on."
                  : `Shift ${shift.number} is over. What it left is on the machines.`}
              </span>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/** Four pinned investigations, each showing one thing Crux does. */
function Guided() {
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
    <Card title="Guided investigations" icon={<Play size={15} />} sub="pinned: each replays the same way" flush>
      <ul className="list">
        {SCENARIOS.map((s) => (
          <li key={s.id}>
            <button type="button" className="scenario" style={{ padding: 0, border: 0, background: "none", width: "100%" }} disabled={busy !== null} onClick={() => start(s)}>
              <div className="row between">
                <h3>{s.title}</h3>
                {busy === s.id ? <LoaderCircle size={14} className="spin dim" /> : <ArrowRight size={14} className="dim" />}
              </div>
              <p className="small">{s.line}</p>
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <div style={{ padding: 12 }}>
          <Callout tone="danger">{error}</Callout>
        </div>
      )}
      <div className="card-foot">
        <Smartphone size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> All four run on {machineById("p2")?.name}.
      </div>
    </Card>
  );
}
