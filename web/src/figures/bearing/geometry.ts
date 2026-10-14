// The bearing figure's drawing: a 6205 ball bearing on a test spindle, the top
// halves of both rings cut away so the balls show, held still by two side pins,
// one of which is the pickup. Everything static is built once per machine
// model; the parts that turn are rebuilt each frame by the functions at the end.
//
// World units are half a millimetre for the bearing (U = 2), so its sizes on
// screen keep their true proportions. The ball set (count, diameter, pitch) is
// the engine's; the ring envelope is the 6205's catalogue size.

import * as k from "../kit/iso-kit";
import * as G from "../kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../kit/tube.mjs";
import type { MachineModel } from "../../api/types";
import { INNER_PIT, OUTER_PIT } from "./model";

type P3 = k.Point3;

export const W = 600;
export const H = 390;
const AZ = 33;
const EL = 34;
const TAU = Math.PI * 2;

const U = 3;
// 6205: 25 mm bore, 52 mm outside, 15 mm wide (dimension series 02, ISO 15).
const BORE = (25 * U) / 2;
const OD = (52 * U) / 2;
const WIDTH = 15 * U;

// Heights, bottom up: plate top at 0, the spindle housing, then the bearing.
const Z_FLANGE = 5;
const Z_BODY = 30;
const Z_CAP = 35;
const Z_RING = 43;

const PLATE: k.Plan = { x: -112, y: -168, w: 224, d: 336, r: 10 };

const sinA = Math.sin((AZ * Math.PI) / 180);
const cosA = Math.cos((AZ * Math.PI) / 180);
/** A floor point from screen-right and toward-the-viewer distances. */
const at = (side: number, toward: number): k.Plane => [side * sinA + toward * cosA, -side * cosA + toward * sinA];
const polar = (r: number, a: number, z: number): P3 => [r * Math.cos(a), r * Math.sin(a), z];
const near = ([x, y]: k.Plane | P3) => x * cosA + y * sinA > 0;

const solid = k.solidSvg;
const line = k.lineSvg;

export type BearingGeo = ReturnType<typeof buildBearing>;

export function buildBearing(m: MachineModel) {
  const rb = (m.bearing.ball_diameter_mm * U) / 2;
  const rp = (m.bearing.pitch_diameter_mm * U) / 2;
  const n = m.bearing.rolling_elements;
  const zc = Z_RING + WIDTH / 2;
  // Raceway bottoms touch the balls; the groove is 52% of the ball's diameter in
  // radius and about a fifth of it deep. Drawing sizes, not numbers on screen.
  const rO = rp + rb;
  const rI = rp - rb;
  const rg = 0.52 * 2 * rb;
  const depth = 0.36 * rb;
  const rOS = rO - depth;
  const rIS = rI + depth;
  const sDrop = Math.sqrt(rg * rg - (rg - depth) ** 2);

  const extreme: P3[] = [...k.boxCorners(PLATE, -17, 0), [0, 0, zc + 14]];
  const P = k.fitProjection(extreme, W, H, { pad: 30, azimuth: AZ, elevation: EL });
  const F = G.frameOf([0, 0, Z_RING], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  const V = G.viewOf(P);

  // ── Base ────────────────────────────────────────────────────────────────
  const base: string[] = [];
  base.push(`<path class="iso-halo" d="${k.haloOf(PLATE, -17, 12, P)}"/>`);
  const feet = [...k.corners(PLATE, 22)].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
  for (const [x, y] of feet) {
    base.push(solid(k.cylinder(x, y, 7.4, -17, 1.6, P, 28), { tone: "lo" }));
    base.push(solid(k.cylinder(x, y, 5.6, -15.4, 3.4, P, 28), { tone: "mid" }));
  }
  base.push(solid(k.slabOf(PLATE, -12, 12, P, 8, 1.6), { tone: "mid", inner: line(k.sideSeam(PLATE, -5, P, 8), { tone: "faint" }) }));
  base.push(line(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "faint" }));
  for (const [x, y] of k.corners(PLATE, 11)) {
    base.push(line(k.ring(x, y, 2.4, 0, P, 18), { tone: "lo" }));
    base.push(k.dotsSvg([k.iso([x, y, 0], P)], { size: 0.55, tone: "mid" }));
  }
  // Label plate, front left: three rule lines stand for the printed text.
  const LABEL: k.Plan = { x: 26, y: 112, w: 20, d: 44, r: 1.6 };
  base.push(solid(k.slabOf(LABEL, 0, 0.8, P, 4), { tone: "lo", crease: "none" }));
  base.push(line(k.planOutline(k.insetPlan(LABEL, 1.8), 0.8, P, 4), { tone: "faint" }));
  [28, 20, 24].forEach((len, i) => {
    const x = LABEL.x + 6 + i * 4.2;
    base.push(line(k.lineOnTop([x, LABEL.y + 10], [x, LABEL.y + 10 + len], 0.8, P), { tone: "lo", free: true }));
  });
  base.push(k.dotsSvg(k.pointsAt([[LABEL.x + LABEL.w / 2, LABEL.y + 4, 0.8], [LABEL.x + LABEL.w / 2, LABEL.y + LABEL.d - 4, 0.8]], P), { size: 0.45, tone: "mid" }));

  // ── Spindle housing ─────────────────────────────────────────────────────
  const housing: string[] = [];
  housing.push(solid(k.cylinder(0, 0, 70, 0, Z_FLANGE, P, 96, 0.8), { tone: "mid" }));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + TAU / 16;
    const [x, y] = [64 * Math.cos(a), 64 * Math.sin(a)];
    housing.push(solid(k.cylinder(x, y, 2.5, Z_FLANGE, 1.6, P, 6), { tone: "mid", crease: "none" }));
    housing.push(line(k.ring(x, y, 1.1, Z_FLANGE + 1.6, P, 12), { tone: "lo" }));
  }
  const fins = (G.ribsOf(G.frameOf([0, 0, 10], [0, 0, 1], [1, 0, 0], [0, 1, 0]), 0, 16, 54, 72, P, { fade: [0.06, 0.5], seams: true }) as G.Faded[]);
  housing.push(
    solid(k.cylinder(0, 0, 54, Z_FLANGE, Z_BODY - Z_FLANGE, P, 96), {
      tone: "mid",
      inner: k.fadedSvg(fins, { tone: "lo" }) + line(k.sideArc(0, 0, 54, 8, P, 48), { tone: "faint" }) + line(k.sideArc(0, 0, 54, 27, P, 48), { tone: "faint" }),
    }),
  );
  housing.push(solid(k.cylinder(0, 0, 57, Z_BODY, Z_CAP - Z_BODY, P, 96, 0.6), { tone: "mid" }));
  housing.push(k.dotsSvg(Array.from({ length: 6 }, (_, i) => k.iso(polar(52, (i / 6) * TAU + 0.3, Z_CAP), P)), { size: 0.5, tone: "mid" }));
  housing.push(solid(k.cylinder(0, 0, 46, Z_CAP, Z_RING - Z_CAP, P, 72), { tone: "lo", inner: line(k.sideArc(0, 0, 46, Z_CAP + 4, P, 40), { tone: "faint" }) }));

  // A cable gland on the housing's near side; the motor lead runs from it to the drive box.
  const glandA = 52 * (Math.PI / 180);
  const glandF = G.frameAlong(polar(54, glandA, 18), [Math.cos(glandA), Math.sin(glandA), 0]);
  housing.push(solid(G.disc(-0.4, 4.6, 6, glandF, P), { tone: "mid" }));
  housing.push(solid(G.disc(4.6, 10, 4, glandF, P), { tone: "lo" }));
  housing.push(line(G.circleOf(glandF, 10, 2.2, P), { tone: "faint" }));

  // ── Bearing rings (lower halves) ────────────────────────────────────────
  const groove = (from: number, to: number, r: (s: number) => number, count = 9): G.Knot[] =>
    Array.from({ length: count + 1 }, (_, i) => {
      const s = from + ((to - from) * i) / count;
      return [s, r(s), 1] as G.Knot;
    });
  const half = WIDTH / 2;
  const outerRace = (s: number) => rO - rg + Math.sqrt(Math.max(0, rg * rg - (half - s) ** 2));
  const innerRace = (s: number) => rI + rg - Math.sqrt(Math.max(0, rg * rg - (half - s) ** 2));
  const outerMeridian: G.Knot[] = [
    [0, rOS + 0.6],
    [0, OD - 0.7],
    [0.7, OD],
    [half, OD],
    [half, rO],
    ...groove(half, half - sDrop, outerRace).slice(1),
    [0.7, rOS],
  ];
  const innerMeridian: G.Knot[] = [
    [0, BORE + 0.7],
    [0, rIS - 0.7],
    [0.7, rIS],
    ...groove(half - sDrop, half, innerRace),
    [half, BORE],
    [0.7, BORE],
  ];
  const outerPaths = G.lathe(outerMeridian, F, P, { hole: [half, rO], rims: "all" });
  const innerPaths = G.lathe(innerMeridian, F, P, { hole: [half, BORE] });
  const outerSeam = line(G.arcOf(F, 7, OD, P), { tone: "faint" });
  const outer = solid(outerPaths, { tone: "hi", inner: outerSeam });
  const inner = solid(innerPaths, { tone: "hi" });

  // The near half of the outer ring is drawn again over the balls, clipped
  // below the cut edge, so a ball sinks into its groove behind the ring wall.
  const ARC = 72;
  const facing = Math.atan2(V[1], V[0]);
  const edge = Array.from({ length: ARC + 1 }, (_, i) => k.iso(polar(rO, facing - Math.PI / 2 + (i / ARC) * Math.PI, zc), P));
  const [l, r] = [edge[0], edge[ARC]];
  const lo = l[0] < r[0] ? l : r;
  const hi = l[0] < r[0] ? r : l;
  const outerClip = k.pathOf([[lo[0] - 40, lo[1]], ...(l[0] < r[0] ? edge : [...edge].reverse()), [hi[0] + 40, hi[1]], [hi[0] + 40, H + 40], [lo[0] - 40, H + 40]], true);

  // The pit on the outer race: a bite out of the cut edge running down into the groove.
  const pitOuter = pitSvg(OUTER_PIT, rO, outerRace, half, +1);

  function pitSvg(a: number, rEdge: number, race: (s: number) => number, s1: number, sign: 1 | -1) {
    const z = (s: number) => Z_RING + s;
    const w = (s: number) => 0.07 * Math.sqrt(Math.max(0, (s - (s1 - 6.3)) / 6.3));
    const ss = Array.from({ length: 8 }, (_, i) => s1 - 6.3 + (6.3 * (i + 1)) / 8);
    const jag = [1, 0.8, 1.15, 0.9, 1.05, 0.85, 1.1, 1];
    const left = ss.map((s, i) => k.iso(polar(race(s), a - w(s) * jag[i], z(s)), P));
    const right = ss.map((s, i) => k.iso(polar(race(s), a + w(s) * jag[7 - i], z(s)), P));
    const face = [0, 0.4, 0.75, 1].map((f, i) => k.iso(polar(rEdge + sign * f * 1.6 * U, a + 0.065 * (1 - f * 0.55) * (i % 2 ? 0.85 : 1), zc), P));
    const faceBack = [1, 0.75, 0.4, 0].map((f, i) => k.iso(polar(rEdge + sign * f * 1.6 * U, a - 0.065 * (1 - f * 0.55) * (i % 2 ? 1 : 0.85), zc), P));
    const race_ = k.pathOf([...left, ...right.reverse()], true);
    const bite = k.pathOf([...face, ...faceBack], true);
    return `<path class="fig-pit" d="${race_}${bite}"/>`;
  }

  // ── Holders: a plain pin on the left, the pickup on the right ───────────
  const holder = (side: number, toward: number, pickup: boolean) => {
    const [px, py] = at(side, toward);
    const out: string[] = [];
    const POST: k.Plan = { x: px - 9, y: py - 9, w: 18, d: 18, r: 3 };
    out.push(solid(k.slabOf(POST, 0, 5, P, 4, 0.6), { tone: "mid" }));
    out.push(k.dotsSvg(k.corners(POST, 3.2).map(([x, y]) => k.iso([x, y, 5], P)), { size: 0.45, tone: "mid" }));
    out.push(solid(k.cylinder(px, py, 4.2, 5, zc - 2 - 5, P, 28), { tone: "mid", crease: "none", inner: line(k.sideArc(px, py, 4.2, 14, P, 16), { tone: "faint" }) }));
    // Clamp block on the post, with its lock screw.
    const CL: k.Plan = { x: px - 7.5, y: py - 7.5, w: 15, d: 15, r: 2.4 };
    const zcl = zc - 15;
    out.push(solid(k.slabOf(CL, zcl, 12, P, 4, 0.6), { tone: "mid", inner: line(k.sideSeam(CL, zcl + 6, P, 4), { tone: "faint" }) }));
    out.push(solid(k.cylinder(px, py, 4.2, zcl + 12, zc - 2 - zcl - 12, P, 28), { tone: "mid", crease: "none" }));
    out.push(solid(k.cylinder(px, py, 5.2, zc - 2, 2.4, P, 28, 0.4), { tone: "mid" }));
    // The arm runs from the clamp to the ring along the line through the axis.
    const dir: P3 = [-px, -py, 0];
    const len = Math.hypot(px, py);
    const Fa = G.frameAlong([px, py, zcl + 6], dir);
    const tip = len - OD;
    out.push(solid(G.disc(7.6, tip - (pickup ? 19 : 7), 3, Fa, P), { tone: "mid" }));
    if (pickup) {
      // Accelerometer: a hex body on a stud, its connector facing up.
      out.push(solid(G.disc(tip - 19, tip - 17, 5, Fa, P), { tone: "lo" }));
      const hex = G.lathe([[tip - 17, 0], [tip - 17, 8], [tip - 5.6, 8], [tip - 5.6, 0]], Fa, P, { steps: 6 });
      out.push(solid(hex, { tone: "mid", className: "fig-pickup" }));
      out.push(solid(G.disc(tip - 5.6, tip - 1.8, 5.6, Fa, P), { tone: "mid", className: "fig-pickup" }));
      out.push(solid(G.disc(tip - 1.8, tip, 2.8, Fa, P), { tone: "hi", className: "fig-pickup" }));
    } else {
      out.push(solid(G.disc(tip - 7, tip, 4.4, Fa, P, { bevel: 0.4 }), { tone: "lo" }));
    }
    return { svg: out.join(""), frame: Fa, tip, top: [px, py, zcl + 6] as P3 };
  };
  const left = holder(-132, -6, false);
  const right = holder(132, -12, true);

  // ── Meter: a box at the front right with a dial that kicks at each knock ──
  const [mx, my] = [84, -60];
  const BOX: k.Plan = { x: mx - 20, y: my - 28, w: 40, d: 56, r: 4 };
  const BOX_H = 22;
  const meter: string[] = [];
  meter.push(`<path class="iso-halo" d="${k.haloOf(BOX, 0, 3, P)}"/>`);
  meter.push(solid(k.slabOf(BOX, 0, BOX_H, P, 6, 1.2), { tone: "mid", inner: line(k.sideSeam(BOX, 5, P, 6), { tone: "faint" }) }));
  meter.push(line(k.planOutline(k.insetPlan(BOX, 3.2), BOX_H, P, 6), { tone: "faint" }));
  meter.push(k.dotsSvg(k.corners(BOX, 5.2).map(([x, y]) => k.iso([x, y, BOX_H], P)), { size: 0.45, tone: "mid" }));
  const dial: P3 = [mx + 2, my + 6, BOX_H];
  const DR = 15;
  const top = BOX_H + 6;
  meter.push(solid(k.cylinder(dial[0], dial[1], DR, BOX_H, 6, P, 64, 0.8), { tone: "hi", crease: "lo" }));
  meter.push(line(k.knurl(dial[0], dial[1], DR, top - 3, top, 72, P, 0.3), { tone: "lo" }));
  meter.push(line(k.ring(dial[0], dial[1], DR - 2, top, P, 64), { tone: "lo" }));
  const ticks = k.radialTicks(dial[0], dial[1], DR - 2.6, 20, 5, top, [1.2, 2.6], P, -Math.PI * 0.75, Math.PI * 1.5);
  meter.push(line(ticks.minor, { tone: "lo" }), line(ticks.major, { tone: "mid" }));
  meter.push(line(k.ring(dial[0], dial[1], 1.4, top, P, 16), { tone: "hi" }));
  // Socket for the pickup lead at the box's back corner.
  const socket: P3 = [mx - 12, my - 20, BOX_H];
  meter.push(solid(k.cylinder(socket[0], socket[1], 3.6, BOX_H, 2.4, P, 24), { tone: "mid" }));

  // ── Drive: a box at the front left with the speed knob; the motor lead comes in at its back ──
  const [cx, cy] = [74, 88];
  const DRIVE: k.Plan = { x: cx - 18, y: cy - 26, w: 36, d: 52, r: 4 };
  const DRIVE_H = 18;
  const drive: string[] = [];
  drive.push(`<path class="iso-halo" d="${k.haloOf(DRIVE, 0, 3, P)}"/>`);
  drive.push(solid(k.slabOf(DRIVE, 0, DRIVE_H, P, 6, 1.2), { tone: "mid", inner: line(k.sideSeam(DRIVE, 4.5, P, 6), { tone: "faint" }) }));
  drive.push(line(k.planOutline(k.insetPlan(DRIVE, 3.2), DRIVE_H, P, 6), { tone: "faint" }));
  drive.push(k.dotsSvg(k.corners(DRIVE, 5.2).map(([x, y]) => k.iso([x, y, DRIVE_H], P)), { size: 0.45, tone: "mid" }));
  const knob: P3 = [cx + 2, cy + 6, DRIVE_H];
  drive.push(solid(k.cylinder(knob[0], knob[1], 9.4, DRIVE_H, 1.2, P, 40), { tone: "lo" }));
  drive.push(solid(k.cylinder(knob[0], knob[1], 7.4, DRIVE_H + 1.2, 6, P, 40), { tone: "mid" }));
  drive.push(line(k.knurl(knob[0], knob[1], 7.4, DRIVE_H + 1.2, DRIVE_H + 7.2, 44, P), { tone: "lo" }));
  // The speed scale: ticks hang inward from a printed ring round the knob.
  drive.push(line(k.ring(knob[0], knob[1], 12.6, DRIVE_H, P, 64), { tone: "faint" }));
  const kt = k.radialTicks(knob[0], knob[1], 12.6, 11, 5, DRIVE_H, [1.4, 2.6], P, -Math.PI * 0.75, Math.PI * 1.5);
  drive.push(line(kt.minor, { tone: "lo" }), line(kt.major, { tone: "mid" }));
  // Power switch: a rocker in a bezel at the back left of the lid.
  const SW: k.Plan = { x: cx - 12, y: cy - 20, w: 8, d: 11, r: 1.2 };
  drive.push(solid(k.slabOf(SW, DRIVE_H, 1.4, P, 3, 0.3), { tone: "lo" }));
  drive.push(solid(k.slabOf(k.insetPlan(SW, 1.6), DRIVE_H + 1.4, 1.6, P, 3, 0.3), { tone: "mid" }));
  const inlet: P3 = [cx - 9, cy + 12, DRIVE_H];
  drive.push(solid(k.cylinder(inlet[0], inlet[1], 3.8, DRIVE_H, 2.6, P, 24), { tone: "mid" }));
  const motorLead = G.fillet([G.pointOf(glandF, 10, 0, 0), G.pointOf(glandF, 18, 0, 0), [inlet[0] - 0.5, inlet[1] - 0.5, 31], [inlet[0], inlet[1], DRIVE_H + 2.6]], 8, 7, { P, tube: 1.6 });
  const motorSvg = tubePieces(motorLead, 1.6, P, { maxLength: 80 }).map((p) => tubeSvg(p, { tone: "mid" })).join("");

  // Pickup lead: up from the accelerometer's connector, over and down into the socket.
  const conn = G.pointOf(right.frame, right.tip - 11, 8, 0);
  const up: P3 = [conn[0], conn[1], conn[2] + 10];
  const lead2 = G.fillet([conn, up, [socket[0] - 4, socket[1] + 2, up[2]], [socket[0], socket[1], BOX_H + 2.4]], 8, 7, { P, tube: 1.1 });
  const pickupLead = tubePieces(lead2, 1.1, P, { maxLength: 80 }).map((p) => tubeSvg(p, { tone: "mid" })).join("");

  // ── Parts that turn, rebuilt each frame ─────────────────────────────────
  const landPlan = (a: number, z0: number): string => {
    const d = (0.36 * (TAU * rp / n - 2 * rb)) / rp;
    const arc = (r: number, from: number, to: number) => Array.from({ length: 5 }, (_, i) => [r * Math.cos(from + ((to - from) * i) / 4), r * Math.sin(from + ((to - from) * i) / 4)] as k.Plane);
    const ring = [...arc(rp + 3.6, a - d, a + d), ...arc(rp - 3.6, a + d, a - d)];
    return solid(k.extrude(ring, z0, 3, P, { convex: true }), { tone: "lo", crease: "none" });
  };
  /** Balls and cage lands, split into the ones behind the inner ring and the ones in front. */
  function balls(cage: number, litIndex = 0) {
    type Item = { key: number; svg: string; near: boolean };
    const items: Item[] = [];
    for (let i = 0; i < n; i++) {
      const a = cage + (i / n) * TAU;
      const c = polar(rp, a, zc);
      items.push({ key: k.depthOf(c, P), near: near(c), svg: solid(G.sphereOf(c, rb, P, { steps: 40 }), { tone: "hi", className: i === litIndex ? "fig-ball is-lit" : "fig-ball" }) });
      const la = a + TAU / n / 2;
      const lc = polar(rp, la, zc - 3);
      const rivet = polar(rp, la, zc);
      items.push({
        key: k.depthOf(lc, P) - 0.5,
        near: near(lc),
        svg: landPlan(la, zc - 3) + solid(k.cylinder(rivet[0], rivet[1], 1.8, zc, 1.4, P, 14), { tone: "mid", crease: "none" }),
      });
    }
    items.sort((a, b) => a.key - b.key);
    return { far: items.filter((x) => !x.near).map((x) => x.svg).join(""), near: items.filter((x) => x.near).map((x) => x.svg).join("") };
  }

  /** The clamp washer and hex nut on the spindle, which show the shaft turning. */
  function spindle(shaft: number) {
    const out: string[] = [];
    const ring = (r: number, steps: number, phase: number) => Array.from({ length: steps }, (_, i) => [r * Math.cos(phase + (i / steps) * TAU), r * Math.sin(phase + (i / steps) * TAU)] as k.Plane);
    out.push(solid(k.extrude(ring(BORE + 4, 72, 0), zc, 3.2, P, { bevel: 0.5 }), { tone: "mid" }));
    const zw = zc + 3.2;
    // From the middle of a nut flat to the washer's rim: the nut's flats sit at the shaft angle.
    const flat = 24 * Math.cos(Math.PI / 6);
    const mark = (a: number) => k.lineOnTop([flat * Math.cos(a), flat * Math.sin(a)], [(BORE + 4) * Math.cos(a), (BORE + 4) * Math.sin(a)], zw, P);
    out.push(line(mark(shaft) + mark(shaft + Math.PI), { tone: "lit" }));
    out.push(solid(k.extrude(ring(24, 6, shaft + Math.PI / 6), zw, 8, P, { bevel: 0.7 }), { tone: "mid" }));
    out.push(line(k.ring(0, 0, 20.5, zw + 8, P, 48), { tone: "faint" }));
    out.push(solid(k.extrude(ring(12, 40, 0), zw + 8, 2.4, P), { tone: "lo" }));
    out.push(line(k.ring(0, 0, 4, zw + 10.4, P, 20), { tone: "lo" }));
    return out.join("");
  }

  /** The inner-race pit, carried round by the shaft; drawn only where it faces the viewer or the sky. */
  function innerPit(shaft: number) {
    return pitSvg(shaft + INNER_PIT, rI, innerRace, half, -1).replace('class="fig-pit"', `class="fig-pit" data-side="${facingInner(shaft + INNER_PIT) > -0.15 ? "front" : "back"}"`);
  }
  const facingInner = (a: number) => Math.cos(a) * V[0] + Math.sin(a) * V[1];

  /** The dial needle: 0 at rest, 1 at full kick. */
  function needle(level: number) {
    const a = -Math.PI * 0.75 + Math.PI * 1.5 * Math.max(0, Math.min(1, level));
    const tip: k.Plane = [dial[0] + Math.sin(a) * (DR - 3.4), dial[1] - Math.cos(a) * (DR - 3.4)];
    const tail: k.Plane = [dial[0] - Math.sin(a) * 3.2, dial[1] + Math.cos(a) * 3.2];
    return k.lineOnTop(tail, tip, top + 0.2, P);
  }
  /** The speed knob's pointer: 0 at the slowest speed, 1 at the fastest. */
  function knobPointer(f: number) {
    const a = -Math.PI * 0.75 + Math.PI * 1.5 * f;
    return k.lineOnTop([knob[0] + Math.sin(a) * 1.6, knob[1] - Math.cos(a) * 1.6], [knob[0] + Math.sin(a) * 6.4, knob[1] - Math.cos(a) * 6.4], DRIVE_H + 7.2, P);
  }

  return {
    P,
    label: `A ${n}-ball bearing on a test spindle, the top halves of its rings cut away. A pickup on a side pin rests on the outer ring and its lead runs to a dial.`,
    back: base.join("") + left.svg + housing.join(""),
    outer,
    pitOuter,
    outerNear: outer,
    outerClip,
    inner,
    front: right.svg + meter.join("") + pickupLead + drive.join("") + motorSvg,
    balls,
    spindle,
    innerPit,
    needle,
    knobPointer,
  };
}
