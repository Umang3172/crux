// The top of the plant, where a shift starts, plays and ends. Before anything
// has been investigated it is the starting point; while a shift runs it shows
// Crux at work on one machine; afterwards it is one line on who is up next.

import type { ReactNode } from "react";
import { Link } from "react-router";
import { CircleCheck, CircleX, Compass, FastForward, Hourglass, Sunrise } from "lucide-react";
import { beginTour } from "../../tour/steps";
import { brainOf } from "../../lib/ai";
import { useShownProgress } from "../../lib/floorplay";
import { useSmoothHeight } from "../../lib/glide";
import { useHealth } from "../../lib/hooks";
import { OWNER, WORKFLOW, machineById, standingOf } from "../../lib/plant";
import { SHOW_SPEED, skipShiftAnimation, startShift, type Shift, type ShiftItem } from "../../lib/shift";
import type { PlantRow } from "../../lib/useplant";
import { Badge, Button, Ring, SourceTag, cx, type Tone } from "../../ui/kit";
import { FloorPlayer, LiveStage } from "../live";

const busy = (i: ShiftItem) => i.state === "running" || i.state === "showing";
const watchable = (i: ShiftItem) => busy(i) && i.reading?.by === "agents" && !!i.caseId;

/** The machine on stage: the one the visitor picked while it is busy, else the first whose calls can be shown. */
export function stageOf(shift: Shift | null, pick: string | null): string | undefined {
  if (!shift?.running) return undefined;
  return (shift.items.find((i) => i.machine === pick && busy(i)) ?? shift.items.find(watchable) ?? shift.items.find(busy))?.machine;
}

export function ShiftBand({ first, shift, rows, stage, onStage }: { first: boolean; shift: Shift | null; rows: PlantRow[]; stage?: string; onStage: (id: string) => void }) {
  const ref = useSmoothHeight<HTMLDivElement>();
  let body: ReactNode = null;
  if (shift?.running) body = <Live shift={shift} stage={stage} onStage={onStage} />;
  else if (shift) body = <Done shift={shift} rows={rows} />;
  else if (first) body = <Start />;
  return (
    <div className="band-wrap" ref={ref} data-tour="plant-shift">
      <div>{body}</div>
    </div>
  );
}

/** Who does each step of a modelled machine's workflow. */
const LOOP: { who: string; tone: Tone; note?: string }[] = [
  { who: "Machine", tone: "neutral" },
  { who: OWNER.crux, tone: "accent" },
  { who: OWNER.crew, tone: "warn", note: "if needed" },
  { who: OWNER.manager, tone: "warn" },
  { who: OWNER.crew, tone: "warn" },
  { who: OWNER.crux, tone: "accent" },
];

function Start() {
  return (
    <section className="band hero">
      <div className="hero-text">
        <span className="eyebrow">Start here</span>
        <h2>Run a shift on the plant</h2>
        <p>Each modelled machine sends a reading. Crux investigates them side by side.</p>
        <div className="row row-wrap">
          <Button variant="primary" size="lg" icon={<Sunrise size={16} />} onClick={() => void startShift()}>
            Start a shift
          </Button>
          <Button size="lg" icon={<Compass size={16} />} onClick={beginTour}>
            Take the tour
          </Button>
          <SourceTag source="synthetic readings" />
        </div>
      </div>
      <ol className="hero-loop" aria-label="What happens to a machine">
        {WORKFLOW.model.map((step, i) => (
          <li key={step} className={cx(`tone-${LOOP[i].tone}`, LOOP[i].note && "maybe")}>
            <i aria-hidden />
            <b>{step}</b>
            <span>{LOOP[i].who}</span>
            {LOOP[i].note && <small>{LOOP[i].note}</small>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Chip({ it, on, onPick }: { it: ShiftItem; on: boolean; onPick: () => void }) {
  const m = machineById(it.machine);
  const p = useShownProgress(it.reading?.by === "agents" ? it.caseId : undefined);
  const going = busy(it);
  const value = going ? (p && !p.streaming && p.total > 0 ? (p.at + 1) / p.total : null) : it.state === "done" ? 1 : 0;
  const tone: Tone = it.state === "failed" ? "danger" : it.state === "held" ? "warn" : it.reading?.by === "agents" ? "model" : "accent";
  return (
    <button type="button" className={cx("band-chip", on && "on", `is-${it.state}`)} aria-pressed={on} disabled={!going} onClick={onPick} title={it.state === "held" && it.owner ? `No new reading: waits on ${OWNER[it.owner]}` : undefined}>
      {it.state === "held" ? (
        <Hourglass size={13} className="t-warn" aria-hidden />
      ) : it.state === "failed" ? (
        <CircleX size={13} className="t-danger" aria-hidden />
      ) : (
        <span className={cx("chip-ring", value === null && "spin")}>
          <Ring value={value ?? 0.28} size={14} stroke={2.5} tone={tone} />
        </span>
      )}
      {m?.short ?? it.machine}
    </button>
  );
}

function Live({ shift, stage, onStage }: { shift: Shift; stage?: string; onStage: (id: string) => void }) {
  const health = useHealth();
  const brain = brainOf(health.data?.models.investigator);
  const item = shift.items.find((i) => i.machine === stage);
  return (
    <section className="band band-live" aria-label={`Shift ${shift.number}, being investigated`}>
      {shift.items.filter(watchable).map((i) => (
        <FloorPlayer key={i.caseId} caseId={i.caseId!} speed={SHOW_SPEED} />
      ))}
      <header className="band-head">
        <b className="band-title">
          <span className="band-dot" aria-hidden />
          Shift {shift.number}
        </b>
        <div className="band-chips" role="group" aria-label="Machine on stage">
          {shift.items.map((i) => (
            <Chip key={i.machine} it={i} on={i.machine === stage} onPick={() => onStage(i.machine)} />
          ))}
        </div>
        <span className="push" />
        {health.data && !brain.live && <Badge plain>offline stand-in</Badge>}
        {!shift.skip && (
          <Button size="sm" variant="ghost" icon={<FastForward size={13} />} onClick={skipShiftAnimation}>
            Skip to results
          </Button>
        )}
      </header>
      <div className="band-stage">
        {item && watchable(item) ? (
          <LiveStage key={item.caseId} caseId={item.caseId} />
        ) : (
          <p className="band-wait">{item ? `The engine is testing every suspect on ${machineById(item.machine)?.short}.` : "Readings are coming in."}</p>
        )}
      </div>
    </section>
  );
}

function Done({ shift, rows }: { shift: Shift; rows: PlantRow[] }) {
  const waiting = rows.filter((r) => standingOf(r.st) === "person");
  const on = (o: "crew" | "manager" | "control") => waiting.filter((r) => r.st.owner === o).length;
  const failed = shift.items.filter((i) => i.state === "failed");
  const held = shift.items.every((i) => i.state === "held");
  return (
    <section className="band band-done" role="status">
      <CircleCheck size={16} className="t-ok" aria-hidden />
      <b>{held ? "No new readings: every modelled machine waits on a person." : `Shift ${shift.number} is over.`}</b>
      {waiting.length === 0 ? (
        <span className="muted">Nothing waits on a person.</span>
      ) : (
        <span className="band-who">
          {on("control") > 0 && <span className="owner control">Control room {on("control")}</span>}
          {on("crew") > 0 && (
            <Link to="/crew" className="owner crew">
              Maintenance {on("crew")}
            </Link>
          )}
          {on("manager") > 0 && (
            <Link to="/manager" className="owner manager">
              Manager {on("manager")}
            </Link>
          )}
        </span>
      )}
      {failed.length > 0 && <span className="t-danger small">{failed.length} could not be investigated: {failed[0].error}</span>}
    </section>
  );
}
