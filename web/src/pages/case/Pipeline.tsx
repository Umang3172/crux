// Where the investigation is along a modelled machine's workflow, the same six
// steps the plant shows. Each step's tip is a count or a state it holds.

import type { CaseModel } from "../../lib/casemodel";
import { num, pct } from "../../lib/format";
import { WORKFLOW } from "../../lib/plant";
import type { CaseEntry } from "../../lib/session";
import { cx } from "../../ui/kit";

type State = "done" | "now" | "todo" | "skip" | "ok" | "bad";
type Step = { label: string; state: State; tip: string; person?: boolean };

const AFTER: Record<string, string> = {
  verified: "verified",
  still_there: "the fault is still there",
  something_else: "something else shows",
  cause_gone: "that fault is gone; the rest is open",
  cannot_tell: "not settled",
};

export function stepsOf(model: CaseModel | null, entry: CaseEntry): Step[] {
  const [reading, investigate, measure, approve, repair, verify] = WORKFLOW.model;
  if (!model) {
    return [
      { label: reading, state: "done", tip: "taken" },
      { label: investigate, state: "now", tip: "Crux's AI at work" },
      { label: measure, state: "todo", tip: "" },
      { label: approve, state: "todo", tip: "" },
      { label: repair, state: "todo", tip: "" },
      { label: verify, state: "todo", tip: "" },
    ];
  }
  const closed = model.status === "concluded" || model.status === "unresolved";
  const named = model.status === "concluded" && !!model.leader && model.leader.kind !== "healthy";
  const answered = model.checks.filter((c) => c.status === "answered").length;
  const outcome = entry.repair?.result.outcome;
  return [
    { label: reading, state: "done", tip: `${num(model.rpm, 0)} rpm` },
    { label: investigate, state: model.status === "open" ? "now" : "done", tip: `${model.experiments} suspects simulated · leader ${pct(model.leader?.belief)}` },
    {
      label: measure,
      state: model.status === "waiting" ? "now" : model.checks.length ? "done" : closed ? "skip" : "todo",
      tip: model.status === "waiting" ? "waiting for a technician" : model.checks.length ? `${answered} of ${model.checks.length} taken` : closed ? "none needed" : "",
      person: true,
    },
    { label: approve, state: !closed ? "todo" : !named ? "skip" : entry.approved ? "done" : "now", tip: entry.approved ? `by ${entry.approved.by}` : named ? "waiting for a name" : closed ? "nothing to approve" : "", person: true },
    { label: repair, state: !named ? (closed ? "skip" : "todo") : entry.repair ? "done" : entry.approved ? "now" : "todo", tip: entry.repair ? "recorded" : "", person: true },
    { label: verify, state: !named ? (closed ? "skip" : "todo") : outcome ? (outcome === "verified" ? "ok" : "bad") : "todo", tip: outcome ? AFTER[outcome] ?? "" : "" },
  ];
}

/** A thin strip: one segment a step, coloured by where the investigation is. */
export function PipelineStrip({ model, entry }: { model: CaseModel | null; entry: CaseEntry }) {
  const steps = stepsOf(model, entry);
  const verified = entry.repair?.result.outcome === "verified";
  return (
    <ol className={cx("strip", verified && "verified")} aria-label="Where this investigation is">
      {steps.map((s) => (
        <li key={s.label} className={cx("strip-step", s.state, s.person && "person")} aria-current={s.state === "now" ? "step" : undefined} data-tip={s.tip || undefined}>
          <span className="strip-bar" aria-hidden />
          <span className="strip-label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}
