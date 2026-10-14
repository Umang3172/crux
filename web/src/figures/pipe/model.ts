// What the pipework figure knows about the demo clip, and how a model's box
// becomes a part of the drawing.
//
// The drawing is of one clip: water dripping from a rusty welded joint on
// painted wall pipework (Pexels video 5571839, free to use under the Pexels
// licence). Each part below is where that part sits in the clip's frame, read
// off its middle still by eye, as fractions of the width and height. A box the
// vision model draws on that still is matched to the smallest part that holds
// its centre, so the part that turns red is the part the model pointed at.

export type PartId = "upperTee" | "lowerTee" | "drop" | "run" | "riser" | "wall";

type Region = { id: PartId; x0: number; y0: number; x1: number; y1: number; name: string };

export const REGIONS: Region[] = [
  { id: "upperTee", x0: 0.45, y0: 0.18, x1: 0.66, y1: 0.52, name: "the welded joint where the small pipe comes down" },
  { id: "lowerTee", x0: 0.22, y0: 0.3, x1: 0.33, y1: 0.6, name: "the welded joint on the upright pipe" },
  { id: "drop", x0: 0.52, y0: 0.0, x1: 0.61, y1: 0.25, name: "the small pipe coming down" },
  { id: "run", x0: 0.3, y0: 0.28, x1: 1.0, y1: 0.55, name: "the long horizontal pipe" },
  { id: "riser", x0: 0.19, y0: 0.0, x1: 0.31, y1: 1.0, name: "the upright pipe" },
];

/** A model's box, [ymin, xmin, ymax, xmax] on 0..1000, as the part it points at. */
export function partAt(box: [number, number, number, number] | null): PartId {
  if (!box) return "wall";
  const [y0, x0, y1, x1] = box.map((v) => v / 1000);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const holding = REGIONS.filter((r) => cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1);
  if (!holding.length) return "wall";
  return holding.sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0))[0].id;
}

export const partName = (id: PartId) => REGIONS.find((r) => r.id === id)?.name ?? "the wall behind the pipes";

/** Standard gravity, m/s² (CGPM 1901). */
const G = 9.80665;
/**
 * World units per metre. The drawn pipe is 12 units across; if it is a 1-inch
 * line (33.4 mm outside, ASME B36.10M), a unit is 2.78 mm. The clip does not say
 * the size, so this is an assumption the caption states.
 */
export const UNITS_PER_M = 12 / 0.0334;
/** Gravity in world units per second squared, for the falling drops. */
export const G_UNITS = G * UNITS_PER_M;
/** Seconds between drops: drawn, not measured from the clip. */
export const DRIP_EVERY_S = 1.7;
/** Seconds a drop takes to swell before it lets go: drawn. */
export const SWELL_S = 1.1;
