// The pipework from the demo clip, drawn whole: painted steel pipe on a painted
// block wall. An upright pipe rises from a floor flange; a horizontal run is
// welded into its side; a smaller pipe comes down from above and is welded into
// the run. Each run turns into the wall through a ball elbow and a wall plate,
// and two-hole straps hold it to the blocks. The clip shows the middle of this;
// the ends are drawn the way such pipework is fitted.
//
// Sizes are proportions taken from the clip, not dimensions. The parts a model
// can point at (model.ts) are built so any one of them can be drawn red.

import * as k from "../kit/iso-kit";
import * as G from "../kit/lathe.mjs";
import type { PartId } from "./model";

type P3 = k.Point3;

export const W = 600;
export const H = 360;
const AZ = 69;
const EL = 22;

const solid = k.solidSvg;
const line = k.lineSvg;

// World: x along the wall, y out of it, z up.
const FLOOR: k.Plan = { x: -150, y: -36, w: 300, d: 70, r: 3 };
const WALL: k.Plan = { x: -140, y: -30, w: 280, d: 20, r: 0 };
const FACE = WALL.y + WALL.d; // the painted face, y = -10
const COURSE = 66; // a block's height
const BLOCK = 132; // a block's length
const TOP = COURSE * 3; // the wall is cut at the top of the third course

const RR = 6.6; // the upright pipe
const R = 6; // the horizontal run
const RD = 5; // the smaller pipe from above
const YP = FACE + 4 + RR; // pipe centres sit 4 off the wall
const XR = -92; // upright pipe
const ZR = 112; // horizontal run
const XD = 18; // the pipe from above
const XE = 126; // where the run turns into the wall
const ZE = 184; // where the upright and the pipe from above turn into the wall
const JOINT = 11; // half the run's length counted as the upper joint

const UP: P3 = [0, 0, 1];
const X: P3 = [1, 0, 0];
const Y: P3 = [0, 1, 0];

/** A seeded random stream, so the paint chips land in the same places every build. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export type PipeGeo = ReturnType<typeof buildPipes>;

export function buildPipes() {
  const P = k.fitProjection([...k.boxCorners(FLOOR, -6, 0), ...k.boxCorners(WALL, 0, TOP)], W, H, { pad: 14, azimuth: AZ, elevation: EL });
  const V = G.viewOf(P);
  const up = (x: number, y = YP) => G.frameAlong([x, y, 0], UP);
  const alongRun = G.frameAlong([0, YP, ZR], X);
  const intoWall = (x: number, z: number) => G.frameAlong([x, YP, z], [0, -1, 0]);

  // ── Floor and wall ─────────────────────────────────────────────────────
  const base: string[] = [];
  base.push(`<path class="iso-halo" d="${k.haloOf(FLOOR, -6, 8, P)}"/>`);
  base.push(solid(k.slabOf(FLOOR, -6, 6, P, 3, 0.5), { tone: "lo" }));
  // A saw-cut joint in the floor slab, from the front edge to the wall.
  base.push(line(k.lineOnTop([-30, FLOOR.y + FLOOR.d], [-30, WALL.y], 0, P), { tone: "faint" }));
  base.push(line(k.segment([-30, FLOOR.y + FLOOR.d, 0], [-30, FLOOR.y + FLOOR.d, -6], P), { tone: "faint" }));

  base.push(solid(k.slabOf(WALL, 0, TOP, P, 2, 0.6), { tone: "lo" }));
  const joints: string[] = [];
  const xEnd = WALL.x + WALL.w;
  for (let c = 1; c < 3; c++) {
    const z = c * COURSE;
    // Bed joints run edge to edge and wrap the wall's end.
    joints.push(k.segment([WALL.x, FACE, z], [xEnd, FACE, z], P), k.segment([xEnd, FACE, z], [xEnd, WALL.y, z], P));
  }
  for (let c = 0; c < 3; c++) {
    const z0 = c * COURSE;
    const z1 = z0 + COURSE;
    const offset = c % 2 ? -14 : -80;
    for (let x = offset - BLOCK * 2; x < xEnd; x += BLOCK) {
      if (x <= WALL.x + 2 || x >= xEnd - 2) continue;
      joints.push(k.segment([x, FACE, z0], [x, FACE, z1], P));
      if (c === 2) joints.push(k.segment([x, FACE, TOP], [x, WALL.y, TOP], P));
    }
  }
  base.push(line(joints.join(""), { tone: "faint" }));
  // The cut top shows the hollow cores of the top course's blocks.
  const cores: string[] = [];
  for (let x = -80 - BLOCK; x < xEnd; x += BLOCK) {
    for (const f of [0.25, 0.75]) {
      const cx = x + BLOCK * f;
      const plan: k.Plan = { x: cx - 18, y: WALL.y + 5.5, w: 36, d: 9, r: 2.5 };
      if (plan.x > WALL.x + 3 && plan.x + plan.w < xEnd - 3) cores.push(k.planOutline(plan, TOP, P, 4));
    }
  }
  base.push(line(cores.join(""), { tone: "lo" }));
  // Paint chips and pits across the painted face.
  const rand = seeded(5571839);
  const chips: k.Flat[] = [];
  for (let i = 0; i < 70; i++) chips.push(k.iso([WALL.x + 4 + rand() * (WALL.w - 8), FACE, 4 + rand() * (TOP - 8)], P));
  base.push(k.dotsSvg(chips, { size: 0.42, tone: "lo" }));

  // ── Wall plates and the stubs that carry each run into the wall ────────
  const plate = (x: number, z: number) => {
    const F = intoWall(x, z);
    const s = YP - FACE;
    return (
      solid(G.disc(s - 1.6, s, RR + 5, F, P, { bevel: 0.4 }), { tone: "mid" }) +
      k.dotsSvg(G.dotsOf(F, s - 1.6, RR + 3.3, 4, P, { phase: Math.PI / 4, all: true }), { size: 0.42, tone: "mid" }) +
      solid(G.disc(0, s - 1.6, x === XD ? RD : x === XE ? R : RR, F, P), { tone: "hi" })
    );
  };
  base.push(plate(XR, ZE), plate(XD, ZE), plate(XE, ZR));

  // ── Two-hole straps fixing the pipe to the blocks ──────────────────────
  const strapUpright = (z: number) => {
    const s: string[] = [];
    const foot: k.Plan = { x: XR - 15, y: FACE, w: 30, d: 1.4, r: 0.4 };
    s.push(solid(k.slabOf(foot, z - 3.5, 7, P, 2, 0.3), { tone: "mid" }));
    s.push(k.dotsSvg(k.pointsAt([[XR - 11.5, FACE + 1.4, z], [XR + 11.5, FACE + 1.4, z]], P), { size: 0.5, tone: "mid" }));
    return s.join("");
  };
  const strapRun = (x: number) => {
    const s: string[] = [];
    const foot: k.Plan = { x: x - 3.5, y: FACE, w: 7, d: 1.4, r: 0.4 };
    s.push(solid(k.slabOf(foot, ZR - 14, 28, P, 2, 0.3), { tone: "mid" }));
    s.push(k.dotsSvg(k.pointsAt([[x, FACE + 1.4, ZR - 10.5], [x, FACE + 1.4, ZR + 10.5]], P), { size: 0.5, tone: "mid" }));
    return s.join("");
  };
  base.push(strapUpright(150), strapUpright(46), strapRun(84));

  // ── The upright pipe ───────────────────────────────────────────────────
  const upright: string[] = [];
  upright.push(solid(k.cylinder(XR, YP, RR + 5.5, 0, 1.8, P, 40, 0.4), { tone: "mid" }));
  upright.push(k.dotsSvg(G.dotsOf(up(XR), 1.8, RR + 3.6, 3, P, { phase: 0.4, all: true }), { size: 0.45, tone: "mid" }));
  upright.push(solid(G.disc(1.8, ZE, RR, up(XR), P), { tone: "hi" }));
  const band = (z: number, r: number) => solid(G.ringBand(z - 2.2, z + 2.2, r, r + 1.1, up(XR), P), { tone: "mid" });
  upright.push(band(150, RR), band(46, RR));
  upright.push(solid(G.disc(126, 134, RR + 1.3, up(XR), P, { bevel: 0.5 }), { tone: "mid", inner: line(G.arcOf(up(XR), 130, RR + 1.3, P), { tone: "faint" }) }));
  upright.push(solid(G.sphereOf([XR, YP, ZE], RR + 1.4, P), { tone: "hi" }));

  // ── The horizontal run, in three lengths so the joint can be drawn alone ─
  // The run is cut to the upright's curve where it is welded on, as in the clip.
  const runFrame = G.frameOf([XR, YP, ZR], X, Y, UP);
  const runFromUpright = G.saddleOf(runFrame, R, RR, 14, P);
  const runLeft = G.disc(XR + 14, XD - JOINT, R, alongRun, P);
  const runJoint = G.disc(XD - JOINT, XD + JOINT, R, alongRun, P);
  const runRight = G.disc(XD + JOINT, XE, R, alongRun, P);
  const runBand = solid(G.ringBand(84 - 2.2, 84 + 2.2, R, R + 1.1, alongRun, P), { tone: "mid" });
  const runCoupling = solid(G.disc(50, 58, R + 1.3, alongRun, P, { bevel: 0.5 }), { tone: "mid", inner: line(G.arcOf(alongRun, 54, R + 1.3, P), { tone: "faint" }) });
  const elbow = solid(G.sphereOf([XE, YP, ZR], R + 1.4, P), { tone: "hi" });

  // ── The smaller pipe from above, welded into the run ───────────────────
  // Its weld bead is a collar cut to the run; the pipe is drawn after it from
  // the bead's top, so the bead shows as a lip round the pipe.
  const dropFrame = G.frameOf([XD, YP, ZR], UP, Y, [-1, 0, 0]);
  const upperBead = G.saddleOf(dropFrame, R - 0.15, R, R + 2.4, P);
  const dropBody = G.disc(ZR + R + 2.4, ZE, RD, up(XD), P);
  const dropCoupling = solid(G.disc(158, 165, RD + 1.2, up(XD), P, { bevel: 0.5 }), { tone: "mid", inner: line(G.arcOf(up(XD), 161.5, RD + 1.2, P), { tone: "faint" }) });
  const dropElbow = solid(G.sphereOf([XD, YP, ZE], RD + 1.3, P), { tone: "hi" });

  /** Every part drawn in painter's order, with `fault` drawn red. */
  function pipes(fault: PartId | null) {
    const red = (id: PartId) => (fault === id ? { className: "fig-fault" } : {});
    return [
      upright.slice(0, 2).join(""),
      solid(G.disc(1.8, ZE, RR, up(XR), P), { tone: "hi", ...red("riser") }),
      upright.slice(3).join(""),
      solid(runFromUpright, { tone: "hi", ...(fault === "lowerTee" || fault === "run" ? { className: "fig-fault" } : {}) }),
      solid(runLeft, { tone: "hi", ...red("run") }),
      runCoupling,
      solid(runJoint, { tone: "hi", ...(fault === "upperTee" || fault === "run" ? { className: "fig-fault" } : {}) }),
      solid(runRight, { tone: "hi", ...red("run") }),
      runBand,
      elbow,
      solid(upperBead, { tone: "mid", ...red("upperTee") }),
      solid(dropBody, { tone: "hi", ...red("drop") }),
      dropCoupling,
      dropElbow,
    ].join("");
  }

  // ── Rust: streaks on the face of the pipe the viewer sees ──────────────
  const facing = G.unit3([V[0], V[1], 0]);
  const aroundUp = (x: number, r: number, turn: number, z: number): P3 => {
    const a = Math.atan2(facing[1], facing[0]) + turn;
    return [x + r * Math.cos(a), YP + r * Math.sin(a), z];
  };
  const aroundRun = (x: number, turn: number): P3 => {
    // A point on the run's surface at an angle from the side that faces the viewer.
    const n = G.unit3([0, V[1], V[2]]);
    const a = Math.atan2(n[2], n[1]) + turn;
    return [x, YP + R * Math.cos(a), ZR + R * Math.sin(a)];
  };
  function rust() {
    const streaks: k.Flat[][] = [];
    // Down the smaller pipe from its coupling to the weld, wandering a little.
    streaks.push(Array.from({ length: 24 }, (_, i) => k.iso(aroundUp(XD, RD + 0.05, 0.42 + 0.06 * Math.sin(i * 0.9), 157 - i * ((157 - ZR - R - 2.6) / 23)), P)));
    // Round the run just before the joint, where paint has cracked.
    streaks.push(Array.from({ length: 16 }, (_, i) => k.iso(aroundRun(XD - JOINT - 2 + Math.sin(i * 0.7) * 0.6, 1.25 - i * 0.16), P)));
    // Along the underside of the joint, where the water runs.
    streaks.push(Array.from({ length: 16 }, (_, i) => k.iso(aroundRun(XD - JOINT + 1 + i * 1.3, -0.95 + 0.05 * Math.sin(i)), P)));
    // The kit fades a line in its tone's colour; the group gives "lo" the colour of rust.
    return `<g class="fig-rust">${streaks.map((pts) => k.fadeLineSvg(pts, { fade: [2.5, 2.5], tone: "lo" })).join("")}</g>`;
  }

  // ── Drops: where they form and where they land ─────────────────────────
  const dripFrom = (part: PartId): P3 => {
    if (part === "lowerTee") return [XR + RR + 3, YP + 1.5, ZR - R - 0.4];
    if (part === "riser") return [XR + 1, YP + RR - 0.6, 60];
    if (part === "drop") return [XD + 1, YP + 2, ZR + R + 2.4];
    return [XD - 3, YP + 1.6, ZR - R - 0.3];
  };
  /** One drop at height z above the floor, swollen to radius r. */
  function drop(at: P3, r: number) {
    if (r <= 0.05) return "";
    const [x, y, z] = at;
    const c = k.iso([x, y, z - r], P);
    const sc = G.scaleOf(P);
    return `<path class="fig-drop" d="M${(c[0]).toFixed(1)} ${(c[1] - r * 2.1 * sc).toFixed(1)} C${(c[0] + r * 0.4 * sc).toFixed(1)} ${(c[1] - r * 1.1 * sc).toFixed(1)} ${(c[0] + r * 1.05 * sc).toFixed(1)} ${(c[1] - r * 0.3 * sc).toFixed(1)} ${c[0].toFixed(1)} ${(c[1] + r * 0.9 * sc).toFixed(1)} C${(c[0] - r * 1.05 * sc).toFixed(1)} ${(c[1] - r * 0.3 * sc).toFixed(1)} ${(c[0] - r * 0.4 * sc).toFixed(1)} ${(c[1] - r * 1.1 * sc).toFixed(1)} ${c[0].toFixed(1)} ${(c[1] - r * 2.1 * sc).toFixed(1)}Z"/>`;
  }
  /** The wet patch a leak leaves on the floor, and a splash ring that spreads and fades. */
  function puddle(x: number, y: number, ring: number, alpha: number) {
    const wet = `<path class="fig-wet" d="${k.onTop(k.circleRing(x, y, 9, 32), 0.05, P, true)}"/>`;
    if (ring <= 0 || alpha <= 0.01) return wet;
    return wet + `<path class="fig-splash" style="opacity:${alpha.toFixed(2)}" d="${k.onTop(k.circleRing(x, y, ring, 32), 0.1, P, true)}"/>`;
  }

  return {
    P,
    label:
      "Painted steel pipework on a painted block wall: an upright pipe from a floor flange, a horizontal run welded into it, and a smaller pipe welded into the run from above, each turning into the wall at a wall plate.",
    base: base.join(""),
    pipes,
    rust,
    dripFrom,
    drop,
    puddle,
  };
}
