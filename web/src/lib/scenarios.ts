// The demo plant, the pinned scenarios and the options a new case is built
// from. Every scenario has fixed settings, so it replays the same run each
// time and every number on screen comes from that run.

import type { FaultKind, OffListFault, RunParams } from "../api/types";

export const PLANT_NAME = "Demo plant · Line 2";

/** The machine every case here runs on: the engine's physics model of a pump. */
export const PUMP = {
  id: "p2",
  name: "Cooling-water pump P-2",
  short: "pump P-2",
  type: "Centrifugal pump, 1,800 rpm",
  source: "physics model · synthetic",
};

/** The server's own name for that model; the console shows the plant's name for it instead. */
export const ENGINE_MACHINE_NAME = /MechNova bench rig/g;

/** The live sensor's id on the server. */
export const LIVE_SENSOR = "rig-01";

export type Investigator = "engine" | "agents";
export type AnyFault = FaultKind | OffListFault;

export type Scenario = {
  id: string;
  title: string;
  line: string;
  investigator: Investigator;
  params: RunParams;
  shows: string;
};

export const SCENARIOS: Scenario[] = [
  {
    id: "one-check",
    title: "One measurement decides",
    line: "The first reading fits a healthy pump and a worn inner ring almost equally. Crux asks for the one measurement that separates them.",
    investigator: "engine",
    params: { fault: "inner_race", severity: 0.5, seed: 6, extra_noise: 0.45 },
    shows: "Engine with a person",
  },
  {
    id: "off-list",
    title: "A cause that is not on the list",
    line: "Impacts no listed fault predicts. The critic writes a new suspect and the physics tests it.",
    investigator: "agents",
    params: { fault: "rolling_element", severity: 1.0, seed: 1, extra_noise: 0.45 },
    shows: "Investigator and critic",
  },
  {
    id: "documents",
    title: "The answer is in the machine's notes",
    line: "A rhythm no bearing part makes. The critic looks it up in the documents on file and cites the passage.",
    investigator: "agents",
    params: { fault: "aux_pump", severity: 1.0, seed: 1, extra_noise: 0.05 },
    shows: "Document look-up",
  },
  {
    id: "no-cause",
    title: "Nothing explains it",
    line: "An impact that neither the list nor the documents account for. The agents close the case without naming a cause.",
    investigator: "agents",
    params: { fault: "unlisted_impact", severity: 1.0, seed: 1, extra_noise: 0.05 },
    shows: "An honest “no cause yet”",
  },
];

export const scenario = (id: string | null | undefined) => SCENARIOS.find((s) => s.id === id);

export const SEVERITY = [
  { id: "mild", label: "Mild", value: 0.3 },
  { id: "moderate", label: "Moderate", value: 0.5 },
  { id: "severe", label: "Severe", value: 1.0 },
] as const;

export const FLOOR = [
  { id: "quiet", label: "Quiet room", value: 0.05 },
  { id: "noisy", label: "Noisy floor", value: 0.45 },
] as const;

export const ON_LIST: FaultKind[] = ["healthy", "imbalance", "misalignment", "looseness", "outer_race", "inner_race"];
export const OFF_LIST: OffListFault[] = ["rolling_element", "aux_pump", "unlisted_impact"];
export const isOnList = (f: string): f is FaultKind => (ON_LIST as string[]).includes(f);

/**
 * The autonomous run: nine pinned synthetic faults, one of each kind the pump
 * model can be given, sent to the agents one after another.
 */
export const FAULT_SET: RunParams[] = [
  { fault: "healthy", severity: 1.0, seed: 1, extra_noise: 0.05 },
  { fault: "imbalance", severity: 1.0, seed: 1, extra_noise: 0.05 },
  { fault: "misalignment", severity: 1.0, seed: 1, extra_noise: 0.05 },
  { fault: "looseness", severity: 1.0, seed: 1, extra_noise: 0.05 },
  { fault: "outer_race", severity: 1.0, seed: 1, extra_noise: 0.05 },
  { fault: "inner_race", severity: 0.5, seed: 6, extra_noise: 0.45 },
  { fault: "rolling_element", severity: 1.0, seed: 1, extra_noise: 0.45 },
  { fault: "aux_pump", severity: 1.0, seed: 1, extra_noise: 0.05 },
  { fault: "unlisted_impact", severity: 1.0, seed: 1, extra_noise: 0.05 },
];

export const severityLabel = (v: number) => SEVERITY.find((s) => s.value === v)?.label.toLowerCase() ?? `strength ${v}`;
export const floorLabel = (v: number) => FLOOR.find((f) => f.value === v)?.label.toLowerCase() ?? `noise ${v}`;
