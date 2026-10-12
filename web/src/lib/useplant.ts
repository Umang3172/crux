// Everything the plant views read, gathered once: this browser's cases, and
// what the server holds on lives, work orders, scans and the live sensor.

import { machines as fetchLives, scans as fetchScans, streamStatus, tickets as fetchTickets } from "../api/crux";
import { useAsync } from "./hooks";
import { plantMachines, statusOf, type MachineStatus, type PlantData, type PlantMachine } from "./plant";
import { LIVE_SENSOR } from "./scenarios";
import { useSession } from "./session";
import { busyMachines, useShift } from "./shift";

export type PlantRow = { m: PlantMachine; st: MachineStatus };

export function usePlant() {
  const session = useSession();
  const shift = useShift();
  const lives = useAsync(() => fetchLives().catch(() => null), []);
  const tickets = useAsync(() => fetchTickets().catch(() => null), []);
  const scans = useAsync(() => fetchScans().catch(() => null), []);
  const sensor = useAsync(() => streamStatus(LIVE_SENSOR).catch(() => null), []);

  const machines = plantMachines(lives.data?.machines);
  const data: PlantData = { cases: session.cases, tickets: tickets.data, scans: scans.data, sensor: sensor.data, running: busyMachines(shift) };
  const rows: PlantRow[] = machines.map((m) => ({ m, st: statusOf(m, data) }));
  return { session, shift, machines, rows, data, lives: lives.data, tickets, reloadTickets: tickets.reload };
}
