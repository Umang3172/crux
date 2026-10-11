// The server's draft ticket behind a forecast work order. Tickets are kept in
// the server's memory, so after a restart the id may be gone or may belong to
// a newer ticket: the page says so rather than showing the wrong one.

import { useState } from "react";
import { tickets } from "../../api/crux";
import type { Ticket } from "../../api/types";
import { useAsync } from "../../lib/hooks";

export function useTicket(ticketId: string | undefined) {
  const [fresh, setFresh] = useState<Ticket | null>(null);
  const list = useAsync<Ticket[]>(() => (ticketId ? tickets() : Promise.resolve([])), [ticketId]);
  const ticket = fresh && fresh.id === ticketId ? fresh : (list.data?.find((t) => t.id === ticketId) ?? null);
  return {
    ticket,
    loading: list.loading,
    error: list.error,
    reload: list.reload,
    missing: !list.loading && !list.error && !ticket,
    /** Use the ticket a call just returned (after approval) without reading the list again. */
    set: setFresh,
  };
}
