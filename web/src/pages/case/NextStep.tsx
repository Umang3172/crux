// The one thing to do next, for whoever has to do it. Each state of an
// investigation has one primary action, or none when nothing is due.
// Nothing here sends a command to a machine.

import { useState, type ReactNode } from "react";
import { BadgeCheck, CircleCheck, CircleHelp, ClipboardCheck, Crosshair, Eye, FastForward, Hourglass, Radio, RotateCcw, ServerCrash, TriangleAlert, Wrench } from "lucide-react";
import { openLauncher } from "../../app/Launcher";
import type { CatalogTest } from "../../api/types";
import type { CaseModel } from "../../lib/casemodel";
import { clock, num, signed } from "../../lib/format";
import { check } from "../../lib/plain";
import type { PlantMachine } from "../../lib/plant";
import { patchCase, type CaseEntry } from "../../lib/session";
import { Badge, Button, Card, cx, toast, type Tone } from "../../ui/kit";
import { Clamp, EngineWords } from "./bits";
import { TakeReading } from "./Decision";
import type { Mode } from "./Head";

export type TabId = "summary" | "evidence" | "work" | "after";

const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  verified: { label: "Repair verified", tone: "ok" },
  still_there: { label: "Not verified: the fault is still there", tone: "danger" },
  something_else: { label: "That fault is gone, but something else shows", tone: "warn" },
  cause_gone: { label: "That fault is gone; the rest is not settled", tone: "warn" },
  cannot_tell: { label: "Not settled either way", tone: "neutral" },
};

/** A name typed in is the approval. It is kept in this browser. */
export function ApproveForm({ entry }: { entry: CaseEntry }) {
  const [by, setBy] = useState("");
  return (
    <form
      className="approve"
      onSubmit={(e) => {
        e.preventDefault();
        const name = by.trim();
        if (!name) return;
        patchCase(entry.id, { approved: { by: name, at: Date.now() } });
        toast(
          <>
            Approved by <b>{name}</b>
          </>,
        );
      }}
    >
      <input className="input" placeholder="Your name" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Your name, to approve the work" disabled={entry.lost} />
      <Button type="submit" variant="primary" icon={<ClipboardCheck size={14} />} disabled={!by.trim() || entry.lost}>
        Approve work
      </Button>
    </form>
  );
}

/** The approval as a record, for the page's After tab. */
export function ApprovalCard({ entry, action }: { entry: CaseEntry; action: string | null }) {
  return (
    <Card
      id="approval"
      title="Approval"
      icon={<ClipboardCheck size={15} />}
      actions={entry.approved ? <Badge tone="ok" dot>approved</Badge> : <Badge tone="warn" dot>waiting for a name</Badge>}
      foot="Recorded in this browser. Crux never commands a machine."
    >
      {action && (
        <div className="appr-action">
          <EngineWords />
          <Clamp lines={2} className="strong">
            {action}
          </Clamp>
        </div>
      )}
      {entry.approved ? (
        <p>
          Approved by <b>{entry.approved.by}</b> at {clock(entry.approved.at)}.
        </p>
      ) : (
        <ApproveForm entry={entry} />
      )}
    </Card>
  );
}

type Step = { key: string; tone: Tone; icon: ReactNode; eyebrow: string; title: ReactNode; line?: ReactNode; actions?: ReactNode; wide?: boolean };

export type NextProps = {
  entry: CaseEntry;
  /** The investigation as the page shows it now. */
  model: CaseModel | null;
  mode: Mode;
  /** A reading that has just been handed in, while the page shows what it did. */
  landing: { value: number | null } | null;
  /** The engine's recommended action. */
  action: string | null;
  catalogue: CatalogTest[] | null;
  machine: PlantMachine;
  onSkip: () => void;
  onGo: (tab: TabId, anchor?: string) => void;
};

function stepOf(p: NextProps): Step | null {
  const { entry, model, mode } = p;
  const again = (
    <Button icon={<RotateCcw size={14} />} onClick={() => openLauncher({ machine: p.machine.id })}>
      Investigate again
    </Button>
  );
  if (mode === "failed") return { key: "failed", tone: "danger", icon: <ServerCrash size={18} />, eyebrow: "Stopped", title: "This investigation did not finish", line: entry.failed, actions: again };
  if (mode === "stuck") {
    return { key: "stuck", tone: "warn", icon: <TriangleAlert size={18} />, eyebrow: "Shown in part", title: "The page reloaded while Crux's AI worked", line: "The server sends that work once, so the rest is not here.", actions: again };
  }
  if (mode === "live") return { key: "live", tone: "model", icon: <Radio size={18} />, eyebrow: "Now · Crux's AI", title: "Investigating, live", line: "Each call appears as the server reports it." };
  if (mode === "watching") {
    return {
      key: "watching",
      tone: "model",
      icon: <Eye size={18} />,
      eyebrow: "Now · Crux's AI",
      title: "Showing the investigation, call by call",
      line: `Already finished on the server${entry.tookMs ? ` in ${num(entry.tookMs / 1000, 1)} s` : ""}. Shown, not live.`,
      actions: (
        <Button variant="primary" icon={<FastForward size={14} />} onClick={p.onSkip}>
          Skip to the result
        </Button>
      ),
    };
  }
  if (!model) return null;
  if (p.landing) {
    return {
      key: "landing",
      tone: "accent",
      icon: <CircleCheck size={18} />,
      eyebrow: "Reading handed in",
      title: p.landing.value === null ? "The reading is in" : <>The reading is in: <span className="num">{signed(p.landing.value, 2)}</span></>,
    };
  }
  if (model.status === "waiting") {
    const req = model.request;
    const c = model.checks.find((x) => x.status === "waiting");
    if (!req) return { key: "agent-wait", tone: "warn", icon: <Hourglass size={18} />, eyebrow: "Waiting", title: `Waiting for: ${c ? check(c.testId).name.toLowerCase() : "a measurement"}` };
    const names = check(req.test_id);
    const cat = p.catalogue?.find((t) => t.id === req.test_id);
    const downtime = cat?.downtime ?? c?.downtime;
    const facts = [names.where && `At ${names.where}`, (cat?.effort_min ?? c?.minutes) != null && `${cat?.effort_min ?? c?.minutes} min`, downtime && (downtime === "none" ? "machine keeps running" : downtime)].filter(Boolean).join(" · ");
    return {
      key: "measure",
      tone: "accent",
      icon: <Crosshair size={18} />,
      eyebrow: "Next step · Maintenance",
      title: `Take the ${names.name.toLowerCase()}`,
      line: entry.lost ? "Kept in this browser only, so no reading can be handed in." : facts,
      actions: entry.lost ? undefined : <TakeReading entry={entry} req={req} />,
      wide: true,
    };
  }
  if (model.status === "open") return { key: "open", tone: "accent", icon: <Hourglass size={18} />, eyebrow: "Now · Crux", title: "Testing every suspect" };
  if (model.status === "unresolved") {
    return {
      key: "unresolved",
      tone: "neutral",
      icon: <CircleHelp size={18} />,
      eyebrow: "Next step · Control room",
      title: "Inspect before opening the machine",
      line: "Crux named no cause on this evidence.",
      actions: <Button onClick={() => p.onGo("evidence")}>See the evidence</Button>,
    };
  }
  const leader = model.leader;
  if (!leader || leader.kind === "healthy") return { key: "healthy", tone: "ok", icon: <CircleCheck size={18} />, eyebrow: "Done", title: "Nothing to repair" };
  const r = entry.repair?.result;
  if (r) {
    const o = OUTCOME[r.outcome] ?? { label: r.outcome, tone: "neutral" as Tone };
    if (r.outcome === "verified") {
      return { key: "verified", tone: "ok", icon: <BadgeCheck size={18} />, eyebrow: "Done", title: o.label, actions: <Button variant="ghost" onClick={() => p.onGo("after", "repair")}>See the check</Button> };
    }
    return {
      key: `repair-${r.outcome}`,
      tone: o.tone,
      icon: <TriangleAlert size={18} />,
      eyebrow: "Next step · Maintenance",
      title: o.label,
      actions: (
        <Button variant="primary" icon={<Wrench size={14} />} onClick={() => p.onGo("after", "repair")}>
          Open repair check
        </Button>
      ),
    };
  }
  if (entry.approved) {
    return {
      key: "repair",
      tone: "warn",
      icon: <Wrench size={18} />,
      eyebrow: "Next step · Maintenance",
      title: "Record the repair",
      line: `Approved by ${entry.approved.by} at ${clock(entry.approved.at)}`,
      actions: (
        <Button variant="primary" icon={<Wrench size={14} />} onClick={() => p.onGo("after", "repair")} disabled={entry.lost}>
          Record the repair
        </Button>
      ),
    };
  }
  return {
    key: "approve",
    tone: "warn",
    icon: <ClipboardCheck size={18} />,
    eyebrow: "Next step · Manager",
    title: "Approve the work",
    line: p.action ? (
      <span className="next-said">
        <EngineWords />
        <Clamp lines={2}>{p.action}</Clamp>
      </span>
    ) : undefined,
    actions: (
      <div className="next-approve">
        <ApproveForm entry={entry} />
        <span className="next-fine">Recorded in this browser. Crux never commands a machine.</span>
      </div>
    ),
    wide: true,
  };
}

export function NextStep(p: NextProps) {
  const s = stepOf(p);
  if (!s) return null;
  return (
    <section className={cx("next", `tone-${s.tone}`)} aria-label="Next step">
      <div key={s.key} className={cx("next-in", s.wide && "wide")}>
        <span className="next-icon" aria-hidden>
          {s.icon}
        </span>
        <div className="next-text">
          <div className="eyebrow">{s.eyebrow}</div>
          <h2>{s.title}</h2>
          {s.line && <div className="next-line">{s.line}</div>}
        </div>
        {s.actions && <div className="next-actions">{s.actions}</div>}
      </div>
    </section>
  );
}
