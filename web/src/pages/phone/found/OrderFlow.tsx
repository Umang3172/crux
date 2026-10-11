// A demo-pump work order opened in the same browser that drafted it. Its finding
// can only be recorded once the repair has been checked, as on the laptop.

import { machineDef } from "../../../demo/stories";
import type { WorkOrder } from "../../../demo/world";
import { Empty } from "../../../ui/States";
import { OUTCOME, STAGE_LABEL, stageOf } from "../../workorder/model";
import { saveFound } from "../../workorder/saveFound";
import { Flow, type Subject } from "./Flow";

export function OrderFlow({ order }: { order: WorkOrder }) {
  const reached = stageOf(order);
  if (reached === "plan" || reached === "repair" || reached === "check") {
    return (
      <Empty title="Not ready for a finding yet">
        <p>
          {order.id} is at “{STAGE_LABEL[reached]}”. Approve it, repair and check it on the laptop first; what was found comes after.
        </p>
      </Empty>
    );
  }
  const subject: Subject = {
    name: machineDef(order.machine)?.name ?? order.machine,
    source: "physics model · synthetic",
    tagHead: `Work order ${order.id}`,
    tone: order.stage === "closed" ? "stock" : "caution",
    facts: [
      { label: "Work", value: order.title },
      ...(order.repair ? [{ label: "Repair check", value: OUTCOME[order.repair.result.outcome].head }] : []),
    ],
    initialName: order.approvedBy,
    majorNote: "Warning other sites works on forecast work orders. This one stays in this browser.",
    already: order.found ? `Already recorded: ${order.found.text}` : null,
  };
  return <Flow key={order.id} subject={subject} save={(v) => saveFound(order, undefined, v)} />;
}
