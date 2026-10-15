// What the second figure shows for each check in the engine's catalogue
// (GET /tests): which tool goes where, and how long it is held. The names,
// minutes, downtime, capture lengths and steps are the server's; the only thing
// typed here is which spot on the machine each check's own steps point to.

import type { CatalogTest } from "../../api/types";

export type Spot = "housing" | "foot" | "aim";
export type Tool = "pickup" | "thermometer";

export type Plan = { spot: Spot; tool: Tool; stops: boolean };

/** Where each check is taken, read from its procedure in the catalogue. */
const PLANS: Record<string, Plan> = {
  vib_10s: { spot: "housing", tool: "pickup", stops: false },
  envelope: { spot: "housing", tool: "pickup", stops: false },
  half_order: { spot: "foot", tool: "pickup", stops: false },
  temperature: { spot: "aim", tool: "thermometer", stops: false },
  coast_down: { spot: "housing", tool: "pickup", stops: true },
};

export const planOf = (t: CatalogTest): Plan | null => PLANS[t.id] ?? null;

/** Short names for the switch above the figure. */
export const SHORT: Record<string, string> = {
  vib_10s: "Vibration",
  envelope: "Envelope",
  half_order: "Half-order",
  temperature: "Temperature",
  coast_down: "Coast-down",
};

/** Seconds to carry a tool from where it rests to its spot, and back. */
export const CARRY_S = 1.6;
/** Seconds a check with no capture length is shown at its spot before the tour moves on. */
export const SHOW_S = 6;

export const minutes = (m: number) => `${m % 1 ? m.toFixed(1) : m.toFixed(0)} min`;
