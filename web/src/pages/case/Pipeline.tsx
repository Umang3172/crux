// Where the case is in its pipeline, from the first capture to the check after
// the repair. Each stage's note is a count or a state the case itself holds.

import { Activity, AudioWaveform, ChartColumn, CircleCheck, ClipboardCheck, Crosshair, FileText, FlaskConical, Sigma, Workflow, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import type { CaseModel } from "../../lib/casemodel";
import { num, pct } from "../../lib/format";
import { fault } from "../../lib/plain";
import type { CaseEntry } from "../../lib/session";
import { Card, cx } from "../../ui/kit";

type State = "done" | "now" | "todo" | "skip" | "ok";
type Stage = { id: string; label: string; note: string; icon: ReactNode; state: State; person?: boolean };

const REPAIR: Record<string, string> = {
  verified: "repair verified",
  still_there: "fault still there",
  something_else: "something else shows",
  cause_gone: "that fault is gone",
  cannot_tell: "not settled",
};

function stages(model: CaseModel | null, entry: CaseEntry): Stage[] {
  const icon = (n: ReactNode) => n;
  if (!model) {
    // An agent run still going: the case exists, and nothing else is known here yet.
    return [
      { id: "capture", label: "Capture", note: "taken", icon: icon(<AudioWaveform size={15} />), state: "done" },
      { id: "agents", label: "Crux investigating", note: "each step shown as it happens", icon: icon(<Workflow size={15} />), state: "now" },
      { id: "verdict", label: "Verdict", note: "not yet", icon: icon(<CircleCheck size={15} />), state: "todo" },
      { id: "report", label: "Report", note: "", icon: icon(<FileText size={15} />), state: "todo" },
      { id: "handoff", label: "Hand-off", note: "", icon: icon(<ClipboardCheck size={15} />), state: "todo" },
      { id: "repair", label: "Repair check", note: "", icon: icon(<Wrench size={15} />), state: "todo" },
    ];
  }
  const count = (s: string) => model.ledger.filter((l) => l.source === s).length;
  const closed = model.status === "concluded" || model.status === "unresolved";
  const waiting = model.status === "waiting";
  const answered = model.checks.filter((c) => c.status === "answered").length;
  const named = model.status === "concluded" && model.leader && model.leader.kind !== "healthy";
  const measure: State = model.checks.length === 0 ? (closed ? "skip" : "todo") : waiting ? "now" : "done";
  const handoff: State = !closed ? "todo" : !named ? "skip" : entry.approved ? "done" : "now";
  const repair: State = entry.repair ? (entry.repair.result.outcome === "verified" ? "ok" : "done") : named ? "todo" : closed ? "skip" : "todo";

  return [
    { id: "capture", label: "Capture", note: `${num(model.rpm, 0)} rpm`, icon: icon(<AudioWaveform size={15} />), state: "done" },
    { id: "observe", label: "Observe", note: `${count("sensor")} readings`, icon: icon(<Activity size={15} />), state: "done" },
    { id: "predict", label: "Predict", note: `${count("physics")} from the physics`, icon: icon(<Sigma size={15} />), state: "done" },
    { id: "experiments", label: "Virtual experiments", note: `${model.experiments} suspects simulated`, icon: icon(<FlaskConical size={15} />), state: "done" },
    { id: "beliefs", label: "Beliefs", note: `leader at ${pct(model.leader?.belief)}`, icon: icon(<ChartColumn size={15} />), state: "done" },
    {
      id: "measure",
      label: "Measurement",
      note: measure === "skip" ? "none was needed" : waiting ? "waiting on a person" : model.checks.length ? `${answered} of ${model.checks.length} taken` : "if the leaders are too close",
      icon: icon(<Crosshair size={15} />),
      state: measure,
      person: true,
    },
    {
      id: "verdict",
      label: "Verdict",
      note: model.status === "concluded" && model.leader ? fault(model.leader.kind).name.toLowerCase() : model.status === "unresolved" ? "no cause named" : "needs 80% belief",
      icon: icon(<CircleCheck size={15} />),
      state: model.status === "concluded" ? "ok" : model.status === "unresolved" ? "done" : "todo",
    },
    { id: "report", label: "Report", note: closed ? "written and checked" : "", icon: icon(<FileText size={15} />), state: closed ? "done" : "todo" },
    {
      id: "handoff",
      label: "Hand-off",
      note: handoff === "skip" ? "nothing to approve" : entry.approved ? `approved by ${entry.approved.by}` : handoff === "now" ? "waiting for a name" : "",
      icon: icon(<ClipboardCheck size={15} />),
      state: handoff,
      person: true,
    },
    {
      id: "repair",
      label: "Repair check",
      note: entry.repair ? (REPAIR[entry.repair.result.outcome] ?? "") : repair === "skip" ? "nothing to repair" : "",
      icon: icon(<Wrench size={15} />),
      state: repair,
    },
  ];
}

export function PipelineCard({ model, entry }: { model: CaseModel | null; entry: CaseEntry }) {
  const list = stages(model, entry);
  return (
    <Card>
      <ol className="pipe" aria-label="Where this investigation is">
        {list.map((s) => (
          <li key={s.id} className={cx("pipe-node", s.state, s.person && "person")} aria-current={s.state === "now" ? "step" : undefined}>
            <span className="pipe-dot">{s.icon}</span>
            <b>{s.label}</b>
            <span>{s.note}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
