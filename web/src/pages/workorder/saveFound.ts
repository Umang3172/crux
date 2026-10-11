// Hand in what was found. A forecast work order's finding goes to the server,
// which keeps it as a lesson; a demo-pump order's finding stays in this browser.
// The work order page and the phone page both end here.

import { outcome } from "../../api/crux";
import type { WorkOrder } from "../../demo/world";
import type { FoundValues } from "./FoundForm";
import type { FleetOutcome } from "./LessonResult";
import { patchOrder } from "./model";

export async function saveFound(order: WorkOrder | null, ticketId: string | undefined, v: FoundValues): Promise<FleetOutcome | null> {
  const lesson = ticketId ? await outcome({ ticket_id: ticketId, found: v.text, right: v.right, by: v.by, major: v.major }) : null;
  if (order) {
    const at = Date.now();
    patchOrder(order.id, (o) => ({ ...o, found: { text: v.text, right: v.right, major: v.major, by: v.by, at }, stage: "closed", closedAt: at }));
  }
  return lesson;
}
