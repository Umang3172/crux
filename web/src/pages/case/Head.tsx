// The investigation at a glance, kept in view while the page scrolls: the
// machine, where the investigation stands, how sure Crux is against the bar,
// who investigated, and how far along its workflow it is.

import type { ReactNode } from "react";
import { Link } from "react-router";
import { BadgeCheck, ChevronRight, CircleCheck, CircleHelp, Eye, Hourglass, LoaderCircle, Radio, ServerCrash, ShieldAlert, TriangleAlert } from "lucide-react";
import { brainOf, runBrain } from "../../lib/ai";
import type { CaseModel } from "../../lib/casemodel";
import { pct, shortId } from "../../lib/format";
import { useHealth } from "../../lib/hooks";
import { CONCLUDE_AT, fault } from "../../lib/plain";
import { MODE, machinePath, type PlantMachine } from "../../lib/plant";
import type { CaseEntry } from "../../lib/session";
import { Badge, CountUp, Ring, SourceTag, cx, vt, type Tone } from "../../ui/kit";
import { PipelineStrip } from "./Pipeline";

/** What the page is showing: the result, or an AI investigation that is still being shown. */
export type Mode = "result" | "watching" | "live" | "stuck" | "failed";

type Pill = { key: string; label: string; tone: Tone; icon: ReactNode };

function pillOf(model: CaseModel | null, entry: CaseEntry, mode: Mode): Pill {
  if (mode === "failed") return { key: "failed", label: "Did not finish", tone: "danger", icon: <ServerCrash size={14} /> };
  if (mode === "stuck") return { key: "stuck", label: "Shown in part", tone: "warn", icon: <TriangleAlert size={14} /> };
  if (mode === "live") return { key: "live", label: "Live", tone: "model", icon: <Radio size={14} /> };
  if (mode === "watching" || !model) return { key: "shown", label: "Being shown", tone: "model", icon: <Eye size={14} /> };
  if (model.status === "waiting") return { key: "waiting", label: "Waiting for a measurement", tone: "warn", icon: <Hourglass size={14} /> };
  if (model.status === "open") return { key: "open", label: "Investigating", tone: "accent", icon: <LoaderCircle size={14} className="spin" /> };
  if (model.status === "unresolved") return { key: "unresolved", label: "No cause named", tone: "neutral", icon: <CircleHelp size={14} /> };
  if (model.leader?.kind === "healthy") return { key: "healthy", label: "No fault found", tone: "ok", icon: <CircleCheck size={14} /> };
  const outcome = entry.repair?.result.outcome;
  if (outcome === "verified") return { key: "verified", label: "Repair verified", tone: "ok", icon: <BadgeCheck size={14} /> };
  if (outcome) return { key: "unverified", label: "Repair not verified", tone: "danger", icon: <TriangleAlert size={14} /> };
  return { key: "named", label: "Cause named", tone: "ok", icon: <CircleCheck size={14} /> };
}

function finding(model: CaseModel | null, mode: Mode): ReactNode {
  if (!model) return mode === "live" ? "Crux's AI is investigating" : mode === "watching" ? "The result follows the showing" : "No result in this browser";
  if (model.status === "concluded" && model.leader) {
    const f = fault(model.leader.kind);
    return (
      <>
        <b>{f.name}</b>
        {f.technical && f.technical !== f.name.toLowerCase() && <span className="mono dim">{f.technical}</span>}
      </>
    );
  }
  if (model.status === "waiting") return <b>Too close to call</b>;
  if (model.status === "unresolved") return <b>The evidence does not carry a cause</b>;
  return "Testing every suspect";
}

const RING_TONE: Record<string, Tone> = { waiting: "warn", open: "accent", concluded: "ok", unresolved: "neutral" };

export function CaseHead({ entry, model, machine, mode }: { entry: CaseEntry; model: CaseModel | null; machine: PlantMachine; mode: Mode }) {
  const health = useHealth();
  const pill = pillOf(model, entry, mode);
  const bar = model?.concludeAt ?? CONCLUDE_AT;
  const belief = model?.leader?.belief ?? 0;
  // A finished run names its own model; one still going is on whatever the server has configured.
  const brain = entry.run ? runBrain(entry.run.model, entry.run.live) : health.data ? brainOf(health.data.models.investigator) : null;

  return (
    <header className={cx("ch", `tone-${pill.tone}`)}>
      <div className="ch-row">
        <span className="ch-ring" data-tip={model ? `Belief in the leading cause. A verdict needs ${pct(bar)}.` : undefined}>
          <Ring value={model ? belief : 0} mark={bar} size={58} stroke={6} tone={model ? (RING_TONE[model.status] ?? "accent") : "model"}>
            {model ? <CountUp value={belief} format={(v) => pct(v)} ms={460} /> : <span className="dim">–</span>}
          </Ring>
        </span>
        <div className="ch-id">
          <nav className="ch-crumbs" aria-label="Breadcrumb">
            <Link to="/cases">Investigations</Link>
            <ChevronRight size={11} aria-hidden />
            <Link to={machinePath(machine)}>{machine.short}</Link>
            <ChevronRight size={11} aria-hidden />
            <span className="mono">{shortId(entry.id)}</span>
          </nav>
          <h1 style={vt(`m-${machine.id}`)}>{machine.name}</h1>
          <div className="ch-finding">{finding(model, mode)}</div>
        </div>
        <div className="ch-side">
          <span key={pill.key} className={cx("ch-pill", `tone-${pill.tone}`)}>
            {pill.icon}
            {pill.label}
          </span>
          <div className="ch-chips">
            {entry.kind === "agents" ? (
              <Badge tone="model" dot title={entry.run?.model}>
                Crux's AI{brain ? ` · ${brain.name}` : ""}
              </Badge>
            ) : (
              <Badge tone="accent" dot>
                Engine + technician
              </Badge>
            )}
            <SourceTag source={MODE.model.source} />
            {model?.hazard && (
              <Badge tone={entry.hazardAck ? "warn" : "danger"}>
                <ShieldAlert size={11} aria-hidden />
                {entry.hazardAck ? "hazard acknowledged" : "hazard reported"}
              </Badge>
            )}
            {entry.lost && <Badge>kept in this browser</Badge>}
          </div>
        </div>
      </div>
      <PipelineStrip model={model} entry={entry} />
    </header>
  );
}
