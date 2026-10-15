// What the pump-set figure knows about its demo clip, and how a scan's finding
// becomes a part of the drawing.
//
// The drawing is of one clip: pump-clean.mp4, an end-suction pump driven
// through a bare jaw coupling by a finned motor on a bolted base (generated for
// the demo, Veo in the Gemini app). Each region below is where that part sits in
// the clip's middle still, the frame the vision model looks at, read off by eye
// as fractions of its width and height. The camera moves in during the clip, so
// they hold for that still only.

import type { Finding } from "../../api/types";

export type PartId = "motor" | "coupling" | "bracket" | "casing" | "suction" | "discharge" | "base";

export const PART_NAME: Record<PartId, string> = {
  motor: "the motor",
  coupling: "the coupling",
  bracket: "the pump's bearing bracket",
  casing: "the pump casing",
  suction: "the suction pipe",
  discharge: "the discharge pipe",
  base: "the base and its hold-down bolts",
};

/** [x0, y0, x1, y1] as frame fractions; a part may sit in two places (the base under each machine). */
const REGIONS: Array<{ id: PartId; at: [number, number, number, number] }> = [
  { id: "discharge", at: [0.08, 0, 0.34, 0.16] },
  { id: "suction", at: [0, 0.3, 0.09, 0.72] },
  { id: "casing", at: [0.06, 0, 0.3, 1] },
  { id: "bracket", at: [0.24, 0.27, 0.38, 0.78] },
  { id: "coupling", at: [0.37, 0.37, 0.53, 0.68] },
  { id: "motor", at: [0.53, 0, 1, 0.86] },
  { id: "base", at: [0.55, 0.86, 1, 1] },
  { id: "base", at: [0.27, 0.78, 0.38, 0.95] },
];

/** The smallest part whose region holds the point (x, y), frame fractions; null off the machine. */
export function partAtPoint(x: number, y: number): PartId | null {
  const area = ([x0, y0, x1, y1]: number[]) => (x1 - x0) * (y1 - y0);
  const hits = REGIONS.filter(({ at: [x0, y0, x1, y1] }) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  return hits.sort((a, b) => area(a.at) - area(b.at))[0]?.id ?? null;
}

/**
 * The part a finding points at: where its box sits on the still when it has
 * one, else what kind of trouble it is.
 */
export function partOf(f: Finding | undefined): PartId | null {
  if (!f) return null;
  if (f.box) {
    const [y0, x0, y1, x1] = f.box;
    const at = partAtPoint((x0 + x1) / 2000, (y0 + y1) / 2000);
    if (at) return at;
  }
  if (f.item === "loose") return "base";
  if (f.item === "belt") return "coupling";
  if (f.item === "heat" || f.item === "smoke") return "motor";
  return "casing";
}

/**
 * The coupling's turning as drawn, turns a second: slowed so an eye can follow
 * it. Nothing in the clip measures its speed, and the readout never quotes it.
 */
export const TURN_HZ_DRAWN = 0.6;
/** A part's shake as drawn, as on the skid figure: slowed and enlarged, world units. */
export const SHAKE_HZ_DRAWN = 3.2;
export const SHAKE_UNITS = 1.6;
