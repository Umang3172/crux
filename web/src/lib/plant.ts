// The plant: a site, its areas and the machines in them. The layout and the
// names are a demo and are labelled as one. What each machine can do is real:
// it is looked after in one of four ways, each backed by routes the server has.
//
//   model   the engine's rotating-machine model at this machine's speed; a
//           fault is fed in and investigated (readings are synthetic)
//   life    a part watched over its whole life, from the server's own list
//   live    a sensor streaming to the server
//   camera  no sensor; a phone video is the only reading
//
// The engine has one machine model: one shaft on one bearing with a bladed
// rotor. The modelled machines here share it and differ in speed only, and
// the machine pages say so.

import type { Tone } from "../ui/kit";
import type { MachineSummary, ScanRow, StreamStatus, Ticket } from "../api/types";
import { modelOf, type CaseModel } from "./casemodel";
import { fault } from "./plain";
import type { CaseEntry } from "./session";

export const SITE = { name: "Demo plant", note: "A demonstration site: its layout and machine names are made up." };

export type Mode = "model" | "life" | "live" | "camera";
export type Kind = "pump" | "fan" | "motor" | "bearing" | "drive";

export type PlantMachine = {
  id: string;
  name: string;
  /** A short name for sentences: "pump P-2". */
  short: string;
  type: string;
  area: string;
  mode: Mode;
  kind: Kind;
  /** Shaft speed for a modelled machine; undefined runs the model at its own nominal speed. */
  rpm?: number;
  /** The server's id for a life or a live sensor. */
  ref?: string;
};

export const AREAS = [
  { id: "utilities", name: "Utilities", line: "Water, air and steam for the lines" },
  { id: "line2", name: "Line 2 · Packaging", line: "Filling, conveying and palletising" },
  { id: "bench", name: "Workshop and test bench", line: "Machines on trial and parts run to the end of their life" },
] as const;

const FIXED: PlantMachine[] = [
  { id: "p2", name: "Cooling-water pump P-2", short: "pump P-2", type: "Centrifugal pump", area: "utilities", mode: "model", kind: "pump" },
  { id: "p4", name: "Boiler feed pump P-4", short: "pump P-4", type: "Centrifugal pump", area: "utilities", mode: "model", kind: "pump", rpm: 2950 },
  { id: "f3", name: "Exhaust fan F-3", short: "fan F-3", type: "Centrifugal fan", area: "utilities", mode: "model", kind: "fan", rpm: 1180 },
  { id: "b6", name: "Dust-extraction blower B-6", short: "blower B-6", type: "Centrifugal blower", area: "line2", mode: "model", kind: "fan", rpm: 1480 },
  { id: "c1", name: "Conveyor drive C-1", short: "drive C-1", type: "Geared conveyor drive", area: "line2", mode: "camera", kind: "drive" },
  { id: "d7", name: "Palletiser drive D-7", short: "drive D-7", type: "Geared drive", area: "line2", mode: "camera", kind: "drive" },
  { id: "m1", name: "Bench motor M-1", short: "motor M-1", type: "Small induction motor", area: "bench", mode: "live", kind: "motor", ref: "rig-01" },
];

/** The fixed machines, then one for each life the server has on file. */
export function plantMachines(lives: MachineSummary[] | null | undefined): PlantMachine[] {
  const fromServer: PlantMachine[] = (lives ?? []).map((m) => ({
    id: `life:${m.machine}`,
    name: m.name,
    short: m.name,
    type: `${m.parts} part${m.parts === 1 ? "" : "s"} watched over ${Math.round(m.end_h)} h`,
    area: "bench",
    mode: "life",
    kind: "bearing",
    ref: m.machine,
  }));
  return [...FIXED, ...fromServer];
}

export const MODELLED = FIXED.filter((m) => m.mode === "model");
export const machineById = (id: string | undefined, all: PlantMachine[] = FIXED) => all.find((m) => m.id === id);
/** The machine a case is on. Cases opened before machines had ids were all on pump P-2. */
export const machineOfCase = (entry: Pick<CaseEntry, "machine"> | undefined) => machineById(entry?.machine) ?? FIXED[0];
export const machinePath = (m: PlantMachine) => (m.mode === "life" && m.ref ? `/lives/${m.ref}` : `/machines/${m.id}`);

export const MODE: Record<Mode, { label: string; source: string; care: string }> = {
  model: { label: "Investigated on demand", source: "engine's model · synthetic", care: "A reading is taken and Crux investigates it: it tests every suspect on a model of the machine and asks for a measurement only when it cannot tell." },
  life: { label: "Watched over its life", source: "watched by trend", care: "Crux follows the part's health from new. When its vibration stays well above its own normal an alarm fires, with a range for how long is left." },
  live: { label: "Live sensor", source: "live sensor", care: "A sensor streams to the server. Once a full capture is in, the same investigation runs on the real reading." },
  camera: { label: "No sensor: phone scan", source: "no sensor", care: "Nothing is fitted. A ten-second phone video is read for motion and sound, and Crux says what to measure next." },
};

/** What happens to a machine, in order, for each way of looking after it. */
export const WORKFLOW: Record<Mode, string[]> = {
  model: ["Reading", "Investigate", "Measure", "Approve", "Repair", "Verify"],
  live: ["Stream", "Capture", "Investigate", "Approve", "Repair", "Verify"],
  life: ["Watch", "Alarm", "Forecast", "Work order", "Approve", "Outcome"],
  camera: ["Scan", "Confirm speed", "Screen", "Measure next"],
};

export type Owner = "crux" | "control" | "crew" | "manager" | null;

export type MachineStatus = {
  /** A short state, as an operator would say it. */
  label: string;
  /** One line on what is happening or what is needed. */
  detail: string;
  tone: Tone;
  /** How far along its workflow the machine is; -1 before the first step. */
  step: number;
  /** Who has to act next, if anyone. */
  owner: Owner;
  busy?: boolean;
  caseId?: string;
  /** Sorts the attention list: higher needs someone sooner. */
  rank: number;
};

export type PlantData = {
  cases: CaseEntry[];
  tickets?: Ticket[] | null;
  scans?: ScanRow[] | null;
  sensor?: StreamStatus | null;
  /** Machines whose investigation is being shown right now. */
  running?: Set<string>;
};

const latestCase = (cases: CaseEntry[], machine: string) => [...cases].filter((c) => (c.machine ?? "p2") === machine).sort((a, b) => b.createdAt - a.createdAt)[0];

function fromCase(entry: CaseEntry, model: CaseModel | null): MachineStatus {
  const caseId = entry.id;
  if (!model) return { label: "Crux is investigating", detail: "testing every suspect on the model", tone: "accent", step: 1, owner: "crux", busy: true, caseId, rank: 3 };
  if (model.hazard && !entry.hazardAck) return { label: "Hazard reported", detail: "make it safe and call a supervisor", tone: "danger", step: 1, owner: "control", caseId, rank: 10 };
  if (model.status === "waiting") {
    const check = model.checks.find((c) => c.status === "waiting");
    return { label: "Needs a measurement", detail: check ? check.name : "one measurement decides", tone: "warn", step: 2, owner: "crew", caseId, rank: 8 };
  }
  if (model.status === "unresolved") return { label: "No cause named", detail: "the evidence does not carry a verdict; inspect before opening it", tone: "warn", step: 1, owner: "control", caseId, rank: 6 };
  if (model.status === "concluded" && model.leader) {
    const name = fault(model.leader.kind).name;
    if (model.leader.kind === "healthy") return { label: "Running normally", detail: "last check found nothing wrong", tone: "ok", step: 1, owner: null, caseId, rank: 0 };
    if (entry.repair) {
      const ok = entry.repair.result.outcome === "verified";
      return ok
        ? { label: "Repaired and verified", detail: `${name.toLowerCase()}: the check after the repair passed`, tone: "ok", step: 5, owner: null, caseId, rank: 0 }
        : { label: "Repair not verified", detail: entry.repair.result.outcome.replace(/_/g, " "), tone: "danger", step: 5, owner: "crew", caseId, rank: 9 };
    }
    if (entry.approved) return { label: "Repair to do", detail: `${name.toLowerCase()}: approved by ${entry.approved.by}`, tone: "warn", step: 4, owner: "crew", caseId, rank: 7 };
    return { label: "Fault found", detail: `${name.toLowerCase()}: the work waits for approval`, tone: "warn", step: 3, owner: "manager", caseId, rank: 7 };
  }
  return { label: "Crux is investigating", detail: "", tone: "accent", step: 1, owner: "crux", busy: true, caseId, rank: 3 };
}

/** Where a machine stands, from the cases, work orders, scans and sensor status that exist. */
export function statusOf(machine: PlantMachine, data: PlantData): MachineStatus {
  if (machine.mode === "model") {
    const entry = latestCase(data.cases, machine.id);
    if (!entry) return { label: "Not checked yet", detail: "no reading has been investigated", tone: "neutral", step: -1, owner: null, rank: 1 };
    if (data.running?.has(machine.id)) return { label: "Crux is investigating", detail: "testing every suspect on the model", tone: "accent", step: 1, owner: "crux", busy: true, caseId: entry.id, rank: 3 };
    return fromCase(entry, modelOf(entry));
  }
  if (machine.mode === "life") {
    const mine = (data.tickets ?? []).filter((t) => t.machine === machine.ref);
    const open = mine.find((t) => t.status === "draft");
    if (open) return { label: "Work order to approve", detail: `${open.part_label}: drafted from its alarm`, tone: "warn", step: 4, owner: "manager", rank: 7 };
    if (mine.length) return { label: "Work order approved", detail: `approved by ${mine[mine.length - 1].approved_by}`, tone: "ok", step: 5, owner: "crew", rank: 2 };
    return { label: "Being watched", detail: "open it to see its health against the clock", tone: "neutral", step: 0, owner: null, rank: 1 };
  }
  if (machine.mode === "live") {
    const s = data.sensor;
    if (s && s.seconds > 0) return { label: s.ready ? "Streaming: ready" : "Streaming", detail: `${Math.round(s.seconds)} s buffered`, tone: "ok", step: s.ready ? 1 : 0, owner: null, rank: 1 };
    return { label: "Sensor silent", detail: "no sensor is sending to this server", tone: "neutral", step: -1, owner: null, rank: 0 };
  }
  const scan = (data.scans ?? []).find((s) => s.machine === machine.name);
  if (scan) return { label: scan.analysed ? "Scanned" : "Scan: confirm the speed", detail: scan.summary[0] ?? "a clip is on file", tone: scan.analysed ? "ok" : "warn", step: scan.analysed ? 2 : 1, owner: scan.analysed ? null : "crew", rank: scan.analysed ? 0 : 4 };
  return { label: "Not monitored", detail: "no sensor: scan it with a phone", tone: "neutral", step: -1, owner: null, rank: 0 };
}

export const OWNER: Record<Exclude<Owner, null>, string> = {
  crux: "Crux",
  control: "Control room",
  crew: "Maintenance",
  manager: "Manager",
};
