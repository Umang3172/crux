// Types for the parts of tube.mjs the figures call: pipes and cables split into
// chunks that sort by depth, each drawn as a shaded ribbon.

import type { Point3, Projection } from "./iso-kit";

export type TubePiece = { mid: Point3; wide: boolean; ends: [boolean, boolean]; points: Point3[] };

export function tubePieces(
  points3: Point3[],
  radius: number | ((t: number) => number),
  P: Projection,
  options?: { maxLength?: number; spacing?: number; closed?: boolean; breaks?: number[]; gaps?: [number, number][]; caps?: boolean | [boolean, boolean]; stripes?: "auto" | boolean },
): TubePiece[];
export function tubeSvg(piece: TubePiece, options?: { tone?: "hi" | "mid" | "lo" | "faint" }): string;
