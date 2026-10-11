// What a work order is, in one place: its stages, the words for each outcome of
// the repair check, and the three things a person can say the repair did.

import type { RepairChoice } from "../../api/crux";
import type { RepairOutcome } from "../../api/types";
import { brainOf } from "../../app/ai";
import { REPAIR_SEED } from "../../demo/stories";
import { getWorld, upsertWorkOrder, type WorkOrder, type WorkOrderStage } from "../../demo/world";
import type { TagTone } from "../../ui/Tag";

export const STAGE_LABEL: Record<WorkOrderStage, string> = {
  plan: "Plan and approve",
  repair: "Repair",
  check: "Check",
  found: "What was found",
  closed: "Closed",
};

const ORDER: WorkOrderStage[] = ["plan", "repair", "check", "found", "closed"];

export const isStage = (x: string | null): x is WorkOrderStage => ORDER.includes(x as WorkOrderStage);

/** A recorded run can't be repaired, so a ticket's work order has no repair check. */
export function stagesFor(kind: WorkOrder["kind"]): { id: WorkOrderStage; label: string }[] {
  return ORDER.filter((id) => kind === "case" || id !== "check").map((id) => ({ id, label: STAGE_LABEL[id] }));
}

/** The stage a work order has reached, as its kind can show it. */
export function stageOf(o: WorkOrder): WorkOrderStage {
  return o.kind === "ticket" && o.stage === "check" ? "found" : o.stage;
}

export const laterOf = (a: WorkOrderStage, b: WorkOrderStage): WorkOrderStage => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

/** Change a work order from its latest state: a request that took seconds must not undo what happened meanwhile. */
export function patchOrder(id: string, change: (o: WorkOrder) => WorkOrder): void {
  const current = getWorld().workOrders.find((o) => o.id === id);
  if (current) upsertWorkOrder(change(current));
}

export const OUTCOME: Record<Exclude<RepairOutcome, "">, { head: string; tone: "safety" | "caution" }> = {
  verified: { head: "Repair verified", tone: "safety" },
  still_there: { head: "Not verified: the fault is still there", tone: "caution" },
  something_else: { head: "That fault is gone, but something else shows", tone: "caution" },
  cause_gone: { head: "That fault is gone. The rest isn't settled", tone: "caution" },
  cannot_tell: { head: "Not settled either way", tone: "caution" },
};

export type ChoiceId = "good" | "half" | "misaligned";

/** What the repair did, on the demo pump. The pump model makes the capture that follows. */
export const CHOICES: { id: ChoiceId; title: string; body: string; request: RepairChoice }[] = [
  { id: "good", title: "A good repair", body: "The fault is removed completely.", request: { removed: 1, seed: REPAIR_SEED } },
  { id: "half", title: "Half a repair", body: "Half of the fault is still there.", request: { removed: 0.5, seed: REPAIR_SEED } },
  {
    id: "misaligned",
    title: "Repaired, but left out of line",
    body: "The fault is gone, but putting it back together left the motor and pump shafts out of line.",
    request: { removed: 1, left_behind: "misalignment", seed: REPAIR_SEED },
  },
];

export const choiceTitle = (id: string): string => CHOICES.find((c) => c.id === id)?.title ?? id;

/** The tag's class: a hazard overrides, verified turns it green, a closed order is plain ink. */
export function tagTone(o: WorkOrder, hazard: boolean): TagTone {
  if (hazard) return "danger";
  if (o.repair?.result.outcome === "verified") return "safety";
  return o.stage === "closed" ? "stock" : "caution";
}

/** The model that wrote words, by name; a name this app does not know is shown as given. */
export function writerName(by: string): string {
  if (!by) return "no language model";
  const b = brainOf(by);
  return b.live ? b.name : by;
}

/** Where a recorded run came from, in the server's own words for it. */
export function recordingSource(machine: string): { tag: string; long: string } {
  if (machine.startsWith("xjtu/")) return { tag: "recorded run · XJTU-SY", long: "XJTU-SY accelerated run-to-failure test (Xi'an Jiaotong University)" };
  if (machine.startsWith("ims/")) return { tag: "recorded run · NASA IMS", long: "NASA IMS run-to-failure test (University of Cincinnati)" };
  if (machine.startsWith("demo/")) return { tag: "synthetic pump life", long: "a synthetic pump life, not a recording" };
  return { tag: "recorded run", long: "a recorded run" };
}
