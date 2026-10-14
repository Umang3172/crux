// The bearing figure's one source of motion and numbers. Every rate comes from
// the engine's machine model (GET /machine): how far the cage turns and how
// often a ball passes a point on each ring, per turn of the shaft. Nothing here
// is typed in; a different bearing on the server gives a different figure.

import type { MachineModel } from "../../api/types";

export type Damage = "none" | "outer" | "inner";

export const DAMAGE: { id: Damage; label: string; title: string }[] = [
  { id: "outer", label: "Outer race", title: "A pit on the ring that stays still" },
  { id: "inner", label: "Inner race", title: "A pit on the ring that turns with the shaft" },
  { id: "none", label: "No damage", title: "The balls roll and nothing knocks" },
];

/** Seconds on screen for one shaft turn at the machine's nominal speed. */
export const PERIOD_S = 4;
export const RPM_MIN = 300;
export const RPM_MAX = 3600;

/** Where the outer-race pit sits, in radians round the bearing (fixed with the stand). */
export const OUTER_PIT = (200 * Math.PI) / 180;
/** Where the inner-race pit sits on the inner ring when the shaft is at zero. */
export const INNER_PIT = (20 * Math.PI) / 180;

const TAU = Math.PI * 2;

export type Rates = {
  balls: number;
  /** Turns of the cage (and every ball round the bearing) per shaft turn. */
  cage: number;
  /** Knocks per shaft turn from a pit on each ring. */
  outer: number;
  inner: number;
};

export function ratesOf(m: MachineModel): Rates {
  return { balls: m.bearing.rolling_elements, cage: m.per_shaft_turn.ftf, outer: m.per_shaft_turn.bpfo, inner: m.per_shaft_turn.bpfi };
}

/** Knocks per shaft turn for a damage, 0 when nothing is damaged. */
export const perTurn = (r: Rates, d: Damage) => (d === "outer" ? r.outer : d === "inner" ? r.inner : 0);

/** Knocks per second at a speed: per-turn rate times shaft turns per second. */
export const perSecond = (r: Rates, d: Damage, rpm: number) => (perTurn(r, d) * rpm) / 60;

export type Pose = {
  /** Shaft (inner ring) angle and cage (balls) angle, radians. */
  shaft: number;
  cage: number;
  /** How many balls have passed the pit so far; a change is a knock. */
  passes: number;
};

/**
 * The bearing after `turns` shaft turns. The count of passes is taken from the
 * same angles the balls are drawn at, so a knock on screen happens exactly as a
 * ball reaches the pit, and over a turn they add up to the engine's rate.
 */
export function poseAt(r: Rates, d: Damage, turns: number): Pose {
  const shaft = turns * TAU;
  const cage = turns * r.cage * TAU;
  const pitch = TAU / r.balls;
  let passes = 0;
  if (d === "outer") passes = Math.floor((cage - OUTER_PIT) / pitch);
  if (d === "inner") passes = Math.floor((shaft + INNER_PIT - cage) / pitch);
  return { shaft, cage, passes };
}

/** How far the nearest ball is from the pit, as a fraction of the gap between balls (0 = on it). */
export function nearness(r: Rates, d: Damage, p: Pose): number {
  const pitch = TAU / r.balls;
  const at = d === "outer" ? p.cage - OUTER_PIT : d === "inner" ? p.shaft + INNER_PIT - p.cage : 0;
  const frac = (((at / pitch) % 1) + 1) % 1;
  return Math.min(frac, 1 - frac);
}

export const fmt = (x: number, digits = 1) => x.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });
