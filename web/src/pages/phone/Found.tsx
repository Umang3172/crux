// What did you find, on a phone: the last stage of a work order, for the person
// who opened the machine. A forecast work order's ticket is on the server, so any
// device can reach it; a demo-pump work order lives in the browser that drafted it.

import { useParams } from "react-router";
import { useWorld } from "../../demo/world";
import { Empty } from "../../ui/States";
import { Elsewhere } from "./found/Elsewhere";
import { OrderFlow } from "./found/OrderFlow";
import { TicketFlow } from "./found/TicketFlow";

export default function PhoneFound() {
  const { workOrderId = "" } = useParams();
  const world = useWorld();
  const local = world.workOrders.find((o) => o.id === workOrderId);

  if (workOrderId.startsWith("T-")) {
    const order = world.workOrders.find((o) => o.kind === "ticket" && o.ticketId === workOrderId);
    return <TicketFlow key={workOrderId} ticketId={workOrderId} order={order} />;
  }
  if (local?.kind === "ticket" && local.ticketId) return <TicketFlow key={local.id} ticketId={local.ticketId} order={local} />;
  if (local) return <OrderFlow order={local} />;
  if (workOrderId.startsWith("WO-")) return <Elsewhere id={workOrderId} />;
  return (
    <Empty title="That link isn't a work order">
      <p>Work orders have numbers like WO-0001, and tickets from a forecast like T-0001.</p>
    </Empty>
  );
}
