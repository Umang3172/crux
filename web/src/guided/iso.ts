/**
 * A tiny isometric renderer for the pump scene.
 *
 * Solids are built in world units (x along the shaft, y across the skid, z up),
 * lit by one directional light and projected isometrically. Only faces turned
 * towards the viewer are kept, so each solid is convex on screen and its faces
 * never overlap one another; solids are then drawn back to front by layer and
 * depth. Long runs (pipes, the motor) are cut into short solids so that simple
 * depth sorting stays correct.
 */

export type Vec3 = [number, number, number];

export type Face = { pts: Vec3[]; n: Vec3; color: string };

export type Solid = {
  faces: Face[];
  depth: number;
  layer: number;
  part?: string;
};

const COS30 = Math.cos(Math.PI / 6);

export const project = ([x, y, z]: Vec3): [number, number] => [(x - y) * COS30, (x + y) * 0.5 - z];

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const VIEW = unit([1, 1, 1]);
const LIGHT = unit([-0.35, 0.55, 0.9]);

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** k = 1 is the base colour; below darkens towards black, above lightens towards white. */
export function tone(hex: string, k: number): string {
  const mix = (c: number) => Math.round(k < 1 ? c * k : c + (255 - c) * (k - 1));
  const [r, g, b] = rgb(hex);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

/** Lambert shading with a floor, so faces in shadow keep their colour. */
export const lit = (hex: string, n: Vec3) => tone(hex, 0.6 + 0.48 * Math.max(0, dot(n, LIGHT)));

const depthOf = (p: Vec3) => dot(p, VIEW);

type Opts = { layer?: number; part?: string };

export function box(min: Vec3, max: Vec3, color: string, opts: Opts = {}): Solid {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  return {
    faces: [
      { n: [0, 0, 1], color, pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
      { n: [0, 1, 0], color, pts: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]] },
      { n: [1, 0, 0], color, pts: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]] },
    ],
    depth: depthOf([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]),
    layer: opts.layer ?? 2,
    part: opts.part,
  };
}

export type Axis = "x" | "y" | "z";

/** Point on a circle of radius r around an axis, at angle t, offset s along it. */
export function onCircle(axis: Axis, start: Vec3, r: number, t: number, s: number): Vec3 {
  const c = r * Math.cos(t);
  const d = r * Math.sin(t);
  if (axis === "x") return [start[0] + s, start[1] + c, start[2] + d];
  if (axis === "y") return [start[0] + c, start[1] + s, start[2] + d];
  return [start[0] + c, start[1] + d, start[2] + s];
}

export function cylinder(
  axis: Axis,
  start: Vec3,
  length: number,
  r: number,
  color: string,
  opts: Opts & { segments?: number } = {},
): Solid {
  const seg = opts.segments ?? 32;
  const faces: Face[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * 2 * Math.PI;
    const b = ((i + 1) / seg) * 2 * Math.PI;
    const m = (a + b) / 2;
    const n: Vec3 =
      axis === "x"
        ? [0, Math.cos(m), Math.sin(m)]
        : axis === "y"
          ? [Math.cos(m), 0, Math.sin(m)]
          : [Math.cos(m), Math.sin(m), 0];
    if (dot(n, VIEW) <= 1e-6) continue;
    faces.push({
      n,
      color,
      pts: [
        onCircle(axis, start, r, a, 0),
        onCircle(axis, start, r, b, 0),
        onCircle(axis, start, r, b, length),
        onCircle(axis, start, r, a, length),
      ],
    });
  }
  const capN: Vec3 = axis === "x" ? [1, 0, 0] : axis === "y" ? [0, 1, 0] : [0, 0, 1];
  faces.push({
    n: capN,
    color,
    pts: Array.from({ length: seg }, (_, i) => onCircle(axis, start, r, (i / seg) * 2 * Math.PI, length)),
  });
  return {
    faces,
    depth: depthOf(onCircle(axis, start, 0, 0, length / 2)),
    layer: opts.layer ?? 2,
    part: opts.part,
  };
}

/** An axis-aligned pipe through `points`, sliced for sorting, with a fitting at each bend. */
export function pipe(points: Vec3[], r: number, color: string, opts: Opts = {}): Solid[] {
  const out: Solid[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const k = a[0] !== b[0] ? 0 : a[1] !== b[1] ? 1 : 2;
    const axis: Axis = (["x", "y", "z"] as const)[k];
    const lo = Math.min(a[k], b[k]);
    const len = Math.abs(b[k] - a[k]);
    const slices = Math.max(1, Math.ceil(len / 1.2));
    for (let s = 0; s < slices; s++) {
      const start: Vec3 = [...a];
      start[k] = lo + (len * s) / slices;
      out.push(cylinder(axis, start, len / slices, r, color, { ...opts, segments: 20 }));
    }
    if (i > 0) {
      const start: Vec3 = [...a];
      start[k] = a[k] - r * 1.1;
      out.push(cylinder(axis, start, r * 2.2, r * 1.16, color, { ...opts, segments: 20 }));
    }
  }
  return out;
}

export const toPoints = (pts: Vec3[], scale: number) =>
  pts
    .map((p) => {
      const [x, y] = project(p);
      return `${(x * scale).toFixed(1)},${(y * scale).toFixed(1)}`;
    })
    .join(" ");

export function sortSolids(solids: Solid[]): Solid[] {
  return [...solids].sort((a, b) => a.layer - b.layer || a.depth - b.depth);
}
