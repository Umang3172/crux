// What the motor-and-pump figure knows, and how a scan's findings become a
// part of it. A finding is placed by what it is; where the clip shakes is
// placed by where each part sits in the demo clip's frame.

import type { Finding } from "../../api/types";

export type PartId = "looseBolt" | "motor" | "coupling" | "casing";

export const PART_NAME: Record<PartId, string> = {
  looseBolt: "the front anchor bolt",
  motor: "the motor",
  coupling: "the coupling guard",
  casing: "the pump casing",
};

/** The part a finding points at: a loose or missing part is the anchor bolt the clip shows. */
export function partOf(f: Finding | undefined): PartId | null {
  if (!f) return null;
  if (f.item === "loose") return "looseBolt";
  if (f.item === "leak" || f.item === "crack" || f.item === "corrosion") return "casing";
  if (f.item === "belt") return "coupling";
  return "motor";
}

/**
 * Where each part sits in the demo clip's frame, as fractions of its width and
 * height, read off a still of motor-pump-shake.mp4. They hold for that clip only.
 */
const REGIONS: Record<PartId, [number, number, number, number]> = {
  motor: [0.08, 0.16, 0.53, 0.72],
  coupling: [0.52, 0.38, 0.62, 0.56],
  casing: [0.57, 0, 0.88, 0.7],
  looseBolt: [0.43, 0.7, 0.5, 0.96],
};

/** The smallest part whose region holds the point (x, y), frame fractions; null off the machine. */
export function partAtPoint(x: number, y: number): PartId | null {
  const area = ([x0, y0, x1, y1]: number[]) => (x1 - x0) * (y1 - y0);
  const hits = (Object.keys(REGIONS) as PartId[]).filter((id) => {
    const [x0, y0, x1, y1] = REGIONS[id];
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  });
  return hits.sort((a, b) => area(REGIONS[a]) - area(REGIONS[b]))[0] ?? null;
}

/**
 * The motor's shake as drawn: slowed and enlarged so an eye can follow it. The
 * clip's own rate comes from the motion check and is printed, not drawn.
 */
export const SHAKE_HZ_DRAWN = 3.2;
export const SHAKE_UNITS = 1.6;
/** How far the loose anchor nut drops below the channel's lip at each shake, world units. */
export const NUT_DROP = 3.2;
