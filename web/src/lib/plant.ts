// The plant: a site, its areas and the machines in them. The layout and the
// names are a demo and are labelled as one. What each machine can do is real:
// it is looked after in one of five ways, each backed by routes the server has.
//
//   model    the engine's rotating-machine model at this machine's speed; a
//            fault is fed in and investigated (readings are synthetic)
//   life     a part watched over its whole life, from the server's own list
//   live     a sensor streaming to the server
//   camera   no sensor; a phone video is the only reading
//   history  a recorded sensor history, forecast and screened by Google's
//            models (the Trends tab); never investigated, see MODE below
//
// The engine has one machine model: one shaft on one bearing with a bladed
// rotor. The modelled machines here share it and differ in speed only, and
// the machine pages say so.

import type { Tone } from "../ui/kit";
import type { MachineSummary, ScanRow, StreamStatus, Ticket } from "../api/types";
import { modelOf, type CaseModel } from "./casemodel";
import { check, fault } from "./plain";
import type { CaseEntry } from "./session";

export const SITE = { name: "Demo plant", note: "A made-up demo site. Readings from modelled machines are synthetic." };

export type Mode = "model" | "life" | "live" | "camera" | "history";
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
  /** The server says this life is simulated, not recorded. */
  synthetic?: boolean;
};

export const AREAS = [
  { id: "utilities", name: "Utilities", line: "Water, air and steam" },
  { id: "line2", name: "Line 2 · Packaging", line: "Filling to palletising" },
  { id: "bench", name: "Workshop and test bench", line: "Trials and life tests" },
] as const;

const FIXED: PlantMachine[] = [
  { id: "p2", name: "Cooling-water pump P-2", short: "pump P-2", type: "Centrifugal pump", area: "utilities", mode: "model", kind: "pump" },
  { id: "p4", name: "Boiler feed pump P-4", short: "pump P-4", type: "Centrifugal pump", area: "utilities", mode: "model", kind: "pump", rpm: 2950 },
  { id: "f3", name: "Exhaust fan F-3", short: "fan F-3", type: "Centrifugal fan", area: "utilities", mode: "model", kind: "fan", rpm: 1180 },
  { id: "b6", name: "Dust-extraction blower B-6", short: "blower B-6", type: "Centrifugal blower", area: "line2", mode: "model", kind: "fan", rpm: 1480 },
  { id: "c1", name: "Conveyor drive C-1", short: "drive C-1", type: "Geared conveyor drive", area: "line2", mode: "camera", kind: "drive" },
  { id: "d7", name: "Palletiser drive D-7", short: "drive D-7", type: "Geared drive", area: "line2", mode: "camera", kind: "drive" },
  { id: "m1", name: "Bench motor M-1", short: "motor M-1", type: "Small induction motor", area: "bench", mode: "live", kind: "motor", ref: "rig-01" },
  // The Trends tab's compressor: a public record (MetroPT-3, a metro train's air
  // compressor) replayed as this site's compressed-air supply. `ref` is its
  // source id on the server's /series routes.
  { id: "a1", name: "Air compressor A-1", short: "compressor A-1", type: "Air compressor · replay of a public record", area: "utilities", mode: "history", kind: "motor", ref: "metro" },
];

/** The fixed machines, then one for each life the server has on file. */
export function plantMachines(lives: MachineSummary[] | null | undefined, synthetic?: boolean): PlantMachine[] {
  const fromServer: PlantMachine[] = (lives ?? []).map((m) => ({
    id: `life:${m.machine}`,
    name: m.name,
    short: m.name,
    type: `${m.parts} part${m.parts === 1 ? "" : "s"} · ${Math.round(m.end_h)} h of life`,
    area: "bench",
    mode: "life",
    kind: "bearing",
    ref: m.machine,
    synthetic,
  }));
  return [...FIXED, ...fromServer];
}

export const MODELLED = FIXED.filter((m) => m.mode === "model");
export const machineById = (id: string | undefined, all: PlantMachine[] = FIXED) => all.find((m) => m.id === id);
/** The machine a case is on. Cases opened before machines had ids were all on pump P-2. */
export const machineOfCase = (entry: Pick<CaseEntry, "machine"> | undefined) => machineById(entry?.machine) ?? FIXED[0];
export const machinePath = (m: PlantMachine) => (m.mode === "life" && m.ref ? `/lives/${m.ref}` : `/m/${encodeURIComponent(m.id)}`);
/** The plant machine whose recorded history a Trends source is, if one is on the site. */
export const historyMachine = (source: string) => FIXED.find((m) => m.mode === "history" && m.ref === source);
/** The Trends tab for a machine with a recorded history. */
export const trendsPath = (m: PlantMachine) => `/trends?source=${encodeURIComponent(m.ref ?? "metro")}`;

export const MODE: Record<Mode, { label: string; source: string; care: string }> = {
  model: { label: "Investigated on demand", source: "engine's model · synthetic", care: "Crux tests every suspect on a model of the machine, and asks for a measurement only when it cannot tell." },
  life: { label: "Watched over its life", source: "watched by trend", care: "Crux follows the part's health from new. An alarm fires when vibration stays above its own normal." },
  live: { label: "Live sensor", source: "live sensor", care: "A sensor streams here. A full capture gets the same investigation." },
  camera: { label: "Phone scan only", source: "no sensor", care: "Nothing is fitted. A ten-second phone video is read for motion and sound." },
  history: {
    label: "Sensor history",
    source: "public record · forecast by Google",
    care: "Its recorded sensors are forecast and screened in BigQuery. An air leak is outside Crux's vibration physics, so an unusual reading goes to a person, never to an investigation.",
  },
};

/** What happens to a machine, in order, for each way of looking after it. */
export const WORKFLOW: Record<Mode, string[]> = {
  model: ["Reading", "Investigate", "Measure", "Approve", "Repair", "Verify"],
  live: ["Stream", "Capture", "Investigate", "Approve", "Repair", "Verify"],
  life: ["Watch", "Alarm", "Forecast", "Work order", "Approve", "Outcome"],
  camera: ["Scan", "Confirm speed", "Screen", "Measure next"],
  history: ["Record", "Forecast", "Flag", "Person checks"],
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
  /** What the person whose turn it is does next, and where. */
  next?: { label: string; to: string };
};

export type PlantData = {
  cases: CaseEntry[];
  tickets?: Ticket[] | null;
  scans?: ScanRow[] | null;
  sensor?: StreamStatus | null;
  /** Machines whose investigation is being shown right now. */
  running?: Set<string>;
};

/** The investigation page opens on the part a person needs. */
const onCase = (id: string, tab: "summary" | "work" | "after") => `/cases/${id}?tab=${tab}`;

const latestCase = (cases: CaseEntry[], machine: string) => [...cases].filter((c) => (c.machine ?? "p2") === machine).sort((a, b) => b.createdAt - a.createdAt)[0];

function fromCase(entry: CaseEntry, model: CaseModel | null): MachineStatus {
  const caseId = entry.id;
  const busy: MachineStatus = { label: "Investigating", detail: "testing every suspect", tone: "accent", step: 1, owner: "crux", busy: true, caseId, rank: 3 };
  if (!model) return busy;
  if (model.hazard && !entry.hazardAck) return { label: "Hazard reported", detail: "make it safe; call a supervisor", tone: "danger", step: 1, owner: "control", caseId, rank: 10, next: { label: "Open investigation", to: onCase(caseId, "summary") } };
  if (model.status === "waiting") {
    const w = model.checks.find((c) => c.status === "waiting");
    return { label: "Needs a measurement", detail: w ? check(w.testId).name : "one measurement decides", tone: "warn", step: 2, owner: "crew", caseId, rank: 8, next: { label: "Take measurement", to: onCase(caseId, "summary") } };
  }
  if (model.status === "unresolved") return { label: "No cause named", detail: "inspect before opening it", tone: "warn", step: 1, owner: "control", caseId, rank: 6, next: { label: "Open investigation", to: onCase(caseId, "summary") } };
  if (model.status === "concluded" && model.leader) {
    const name = fault(model.leader.kind).name;
    if (model.leader.kind === "healthy") return { label: "Normal", detail: "nothing wrong at the last check", tone: "ok", step: 1, owner: null, caseId, rank: 0 };
    if (entry.repair) {
      return entry.repair.result.outcome === "verified"
        ? { label: "Repair verified", detail: name.toLowerCase(), tone: "ok", step: 5, owner: null, caseId, rank: 0 }
        : { label: "Repair not verified", detail: entry.repair.result.outcome.replace(/_/g, " "), tone: "danger", step: 5, owner: "crew", caseId, rank: 9, next: { label: "Check repair", to: onCase(caseId, "after") } };
    }
    if (entry.approved) return { label: "Repair to do", detail: `${name.toLowerCase()} · approved by ${entry.approved.by}`, tone: "warn", step: 4, owner: "crew", caseId, rank: 7, next: { label: "Record repair", to: onCase(caseId, "after") } };
    // The finding is the state: what was found, waiting for a name.
    return { label: name, detail: "fault found; waits for sign-off", tone: "warn", step: 3, owner: "manager", caseId, rank: 7, next: { label: "Review and approve", to: onCase(caseId, "work") } };
  }
  return busy;
}

/** Where a machine stands, from the cases, work orders, scans and sensor status that exist. */
export function statusOf(machine: PlantMachine, data: PlantData): MachineStatus {
  if (machine.mode === "model") {
    const entry = latestCase(data.cases, machine.id);
    if (!entry) return { label: "Not checked", detail: "no reading investigated yet", tone: "neutral", step: -1, owner: null, rank: 1 };
    if (data.running?.has(machine.id)) return { label: "Investigating", detail: "testing every suspect", tone: "accent", step: 1, owner: "crux", busy: true, caseId: entry.id, rank: 3 };
    return fromCase(entry, modelOf(entry));
  }
  if (machine.mode === "life") {
    const mine = (data.tickets ?? []).filter((t) => t.machine === machine.ref);
    const open = mine.find((t) => t.status === "draft");
    if (open) return { label: "Work order drafted", detail: open.part_label, tone: "warn", step: 4, owner: "manager", rank: 7, next: { label: "Review work order", to: `/work-orders/${open.id}` } };
    const done = mine.filter((t) => t.status === "approved").pop();
    // An approved work order is a technician's job until its outcome is recorded on the work order.
    if (done) return { label: "Work order approved", detail: `approved by ${done.approved_by}`, tone: "warn", step: 5, owner: "crew", rank: 5, next: { label: "Open work order", to: `/work-orders/${done.id}` } };
    return { label: "Watched", detail: "health followed from new", tone: "neutral", step: 0, owner: null, rank: 1 };
  }
  if (machine.mode === "history") {
    return { label: "History on file", detail: "forecast and screened in Trends", tone: "neutral", step: 1, owner: null, rank: 0, next: { label: "Open its trends", to: trendsPath(machine) } };
  }
  if (machine.mode === "live") {
    const s = data.sensor;
    if (s && s.seconds > 0) return { label: s.ready ? "Capture ready" : "Sensor streaming", detail: `${Math.round(s.seconds)} s buffered`, tone: "neutral", step: s.ready ? 1 : 0, owner: null, rank: 1 };
    return { label: "Sensor silent", detail: "no sensor is sending", tone: "neutral", step: -1, owner: null, rank: 0 };
  }
  const scan = (data.scans ?? []).find((s) => s.machine === machine.name);
  if (scan) {
    return scan.analysed
      ? { label: "Scanned", detail: scan.summary[0] ?? "a clip is on file", tone: "neutral", step: 2, owner: null, rank: 0 }
      : { label: "Confirm the speed", detail: scan.summary[0] ?? "a clip is on file", tone: "warn", step: 1, owner: "crew", rank: 4, next: { label: "Confirm speed", to: `/lens/${scan.id}` } };
  }
  return { label: "No sensor", detail: "phone scan only", tone: "neutral", step: -1, owner: null, rank: 0 };
}

export const OWNER: Record<Exclude<Owner, null>, string> = {
  crux: "Crux",
  control: "Control room",
  crew: "Maintenance",
  manager: "Manager",
};

/** Where a machine stands at a glance. Every machine is in exactly one. */
export type Standing = "person" | "crux" | "ok" | "idle";

export function standingOf(st: MachineStatus): Standing {
  if (st.busy) return "crux";
  if (st.owner && st.owner !== "crux" && st.rank >= 4) return "person";
  // Green only where an investigation found nothing wrong, or a repair was checked.
  if (st.tone === "ok") return "ok";
  return "idle";
}

export const STANDING: Record<Standing, { label: string; tone: Tone }> = {
  person: { label: "Needs a person", tone: "warn" },
  crux: { label: "Crux investigating", tone: "accent" },
  ok: { label: "Normal", tone: "ok" },
  idle: { label: "Not investigated", tone: "neutral" },
};
