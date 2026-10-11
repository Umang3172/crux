// The demo plant and the pinned stories. Every story is a link with fixed
// settings, so each take of the video replays the same run and every narrated
// number comes from it.

import type { FaultKind, OffListFault, RunParams } from "../api/types";

export const PLANT_NAME = "Demo plant · Line 2";

export type MachineKind = "physics" | "live" | "recording" | "unmonitored";

export type MachineDef = {
  id: string;
  name: string;
  type: string;
  kind: MachineKind;
  /** Where its numbers come from, in plain words. */
  source: string;
  /** The live sensor's id on the server, for M-1. */
  sensor?: string;
  /** Recorded runs shown under this tile. */
  recordings?: string[];
};

/** The line, in the order the product flows through it. */
export const LINE: MachineDef[] = [
  { id: "c1", name: "Conveyor drive C-1", type: "Gear motor", kind: "unmonitored", source: "No sensor" },
  {
    id: "p2",
    name: "Cooling-water pump P-2",
    type: "Centrifugal pump, 1,800 rpm",
    kind: "physics",
    source: "Physics model · synthetic, 12 kHz",
  },
  {
    id: "m1",
    name: "Bench motor M-1",
    type: "Small induction motor",
    kind: "live",
    source: "Live sensor · 2 kHz",
    sensor: "rig-01",
  },
  {
    id: "tb",
    name: "Test-bench bearings",
    type: "Run-to-failure rig",
    kind: "recording",
    source: "Recorded runs · XJTU-SY and NASA IMS",
    recordings: ["xjtu/37.5Hz11kN/Bearing2_1"],
  },
  { id: "f3", name: "Exhaust fan F-3", type: "Axial fan", kind: "unmonitored", source: "No sensor" },
];

export const machineDef = (id: string) => LINE.find((m) => m.id === id);

export type Investigator = "engine" | "ai";

export type Story = {
  id: string;
  title: string;
  line: string;
  minutes: number;
  machine: string;
  investigator?: Investigator;
  params?: RunParams & { fault: FaultKind | OffListFault };
  note?: string;
  /** Recorded run for the bearing-life story. */
  recording?: string;
  /** Pages that only make sense on the laptop server. */
  laptopOnly?: boolean;
};

export const REPAIR_SEED = 4242;

export const STORIES: Story[] = [
  {
    id: "one-check",
    title: "One check settles it",
    line: "The first reading looks healthy. Crux can't tell, and asks for the one measurement that decides.",
    minutes: 2,
    machine: "p2",
    investigator: "engine",
    params: { fault: "inner_race", severity: 0.5, seed: 6, extra_noise: 0.45 },
  },
  {
    id: "off-list",
    title: "A cause that isn't on the list",
    line: "Impacts no listed fault explains. The AI writes a new suspect; the physics tests it.",
    minutes: 1,
    machine: "p2",
    investigator: "ai",
    params: { fault: "rolling_element", severity: 1.0, seed: 1, extra_noise: 0.45 },
  },
  {
    id: "documents",
    title: "The AI reads the pump's notes",
    line: "A rhythm no bearing part makes. The AI looks it up in the machine's documents.",
    minutes: 1,
    machine: "p2",
    investigator: "ai",
    params: { fault: "aux_pump", severity: 1.0, seed: 1, extra_noise: 0.05 },
  },
  {
    id: "bearing-life",
    title: "A bearing's whole life",
    line: "A real bearing run to failure: health, the alarm, and how long is left.",
    minutes: 2,
    machine: "tb",
    recording: "xjtu/37.5Hz11kN/Bearing2_1",
  },
];

export const story = (id: string | null | undefined) => STORIES.find((s) => s.id === id);

export const SEVERITY = [
  { id: "mild", label: "Mild", value: 0.3 },
  { id: "moderate", label: "Moderate", value: 0.5 },
  { id: "severe", label: "Severe", value: 1.0 },
] as const;

export const FLOOR = [
  { id: "quiet", label: "Quiet room", value: 0.05 },
  { id: "noisy", label: "Noisy floor", value: 0.45 },
] as const;
