// The pinned guided investigations, the readings a shift sends, and the options
// a new investigation is built from. Settings are fixed, so each replays the
// same way and every number on screen comes from that run.

import type { FaultKind, OffListFault, RunParams } from "../api/types";

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
  /** The plant machine it runs on (lib/plant.ts). */
  machine: string;
  params: RunParams;
  shows: string;
};

export const SCENARIOS: Scenario[] = [
  {
    id: "one-check",
    title: "One measurement decides",
    line: "Two causes fit equally. Crux asks for the one reading that separates them.",
    investigator: "engine",
    machine: "p2",
    params: { fault: "inner_race", severity: 0.5, seed: 6, extra_noise: 0.45 },
    shows: "Engine and technician",
  },
  {
    id: "off-list",
    title: "A cause not on the list",
    line: "Crux's AI writes a new suspect; the physics tests it.",
    investigator: "agents",
    machine: "p2",
    params: { fault: "rolling_element", severity: 1.0, seed: 1, extra_noise: 0.45 },
    shows: "A written suspect",
  },
  {
    id: "documents",
    title: "The answer is in the machine's notes",
    line: "Crux's AI finds the cause in the machine's documents and cites it.",
    investigator: "agents",
    machine: "p2",
    params: { fault: "aux_pump", severity: 1.0, seed: 1, extra_noise: 0.05 },
    shows: "Document look-up",
  },
  {
    id: "no-cause",
    title: "Nothing explains it",
    line: "Crux closes the investigation without naming a cause.",
    investigator: "agents",
    machine: "p2",
    params: { fault: "unlisted_impact", severity: 1.0, seed: 1, extra_noise: 0.05 },
    shows: "No cause named",
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

export type Reading = { by: Investigator; params: RunParams };

/**
 * The readings each modelled machine sends, one per shift, in this order, with
 * pinned settings. Most go to Crux's AI; the first on pump P-2 goes to the
 * engine alone, which stops and asks a technician for a measurement. A machine
 * waiting on a person sends nothing new until that person has acted.
 */
export const READINGS: Record<string, Reading[]> = {
  p2: [
    { by: "engine", params: { fault: "inner_race", severity: 0.5, seed: 6, extra_noise: 0.45 } },
    { by: "agents", params: { fault: "aux_pump", severity: 1.0, seed: 1, extra_noise: 0.05 } },
    { by: "agents", params: { fault: "healthy", severity: 1.0, seed: 1, extra_noise: 0.05 } },
  ],
  p4: [
    { by: "agents", params: { fault: "outer_race", severity: 1.0, seed: 1, extra_noise: 0.05 } },
    { by: "agents", params: { fault: "unlisted_impact", severity: 1.0, seed: 1, extra_noise: 0.05 } },
    { by: "agents", params: { fault: "healthy", severity: 1.0, seed: 1, extra_noise: 0.05 } },
  ],
  f3: [
    { by: "agents", params: { fault: "imbalance", severity: 1.0, seed: 1, extra_noise: 0.05 } },
    { by: "agents", params: { fault: "healthy", severity: 1.0, seed: 1, extra_noise: 0.05 } },
    { by: "agents", params: { fault: "looseness", severity: 1.0, seed: 1, extra_noise: 0.05 } },
  ],
  b6: [
    { by: "agents", params: { fault: "rolling_element", severity: 1.0, seed: 1, extra_noise: 0.05 } },
    { by: "agents", params: { fault: "misalignment", severity: 1.0, seed: 1, extra_noise: 0.05 } },
    { by: "agents", params: { fault: "healthy", severity: 1.0, seed: 1, extra_noise: 0.05 } },
  ],
};

export const severityLabel = (v: number) => SEVERITY.find((s) => s.value === v)?.label.toLowerCase() ?? `strength ${v}`;
export const floorLabel = (v: number) => FLOOR.find((f) => f.value === v)?.label.toLowerCase() ?? `noise ${v}`;
