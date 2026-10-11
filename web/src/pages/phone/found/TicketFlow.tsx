// A forecast work order's ticket is on the server, so the finding can be
// recorded from any device. The ticket is the claim Crux made; the answer goes
// back to the server, which turns it into a lesson.

import { useEffect, useState } from "react";
import { isWaking, onWaking } from "../../../api/client";
import { LINE } from "../../../demo/stories";
import { markSeen, useWorld, type WorkOrder } from "../../../demo/world";
import { plainSentence } from "../../../lib/plain";
import { Empty, ErrorState, Loading } from "../../../ui/States";
import { recordingSource } from "../../workorder/model";
import { saveFound } from "../../workorder/saveFound";
import { useTicket } from "../../workorder/useTicket";
import { Flow, type Subject } from "./Flow";

export function TicketFlow({ ticketId, order }: { ticketId: string; order?: WorkOrder }) {
  const tk = useTicket(ticketId);
  const world = useWorld();
  const [waking, setWaking] = useState(isWaking());
  useEffect(() => onWaking(setWaking), []);

  if (tk.loading) return <Loading>{waking ? "Waking the engine… the first request after a quiet spell takes a few seconds." : "Loading the ticket…"}</Loading>;
  if (tk.error) return <ErrorState error={tk.error} onRetry={tk.reload} />;
  const t = tk.ticket;
  if (!t) {
    return (
      <Empty title="This ticket isn't on the server">
        <p>Tickets are kept in the server's memory. If the server restarted, draft the work order again on the laptop.</p>
      </Empty>
    );
  }

  // The engine's own statement of what it concluded is the claim the finding answers.
  const claim = t.evidence.find((e) => e.kind === "status");
  const key = `found:${t.id}`;
  const recorded = order?.found ? `Already recorded: ${order.found.text}` : world.seen[key] ? "You already recorded what was found on this ticket from this phone." : null;
  const plantName = LINE.find((m) => m.recordings?.includes(t.machine))?.name ?? t.machine_name;

  const subject: Subject = {
    name: plantName,
    source: recordingSource(t.machine).tag,
    tagHead: `Ticket ${t.id}`,
    tone: t.hazard ? "danger" : "caution",
    facts: [
      { label: "Part", value: `${t.part_label}, on ${t.machine_name}` },
      { label: "What Crux said", value: claim ? plainSentence(claim.statement) : "Crux gave no cause on this ticket." },
      { label: "Approval", value: t.status === "approved" ? `Approved by ${t.approved_by}` : "Not approved yet. A person approves it on the laptop." },
    ],
    initialName: t.status === "approved" ? t.approved_by : undefined,
    already: recorded,
  };

  return (
    <Flow
      key={t.id}
      subject={subject}
      save={async (v) => {
        const lesson = await saveFound(order ?? null, t.id, v);
        markSeen(key);
        return lesson;
      }}
    />
  );
}
