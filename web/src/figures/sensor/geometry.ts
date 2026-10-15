// The second figure's drawing: the bench rig as a technician meets it. A motor
// drives a three-blade fan through a jaw coupling and two pillow blocks on a
// bedplate. A phone lies on the bedplate with its pickup parked beside it, and a
// small infrared sensor stands on a magnetic arm. The pickup is carried to the
// spot each check names; the rest is built once.
//
// The rig has no drawing of its own, so sizes are proportions, not dimensions:
// no length on screen is read as a number. The blade count is the engine's.

import * as k from "../kit/iso-kit";
import * as G from "../kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../kit/tube.mjs";
import type { Spot } from "./model";

type P3 = k.Point3;

export const W = 600;
export const H = 330;
const AZ = 57;
const EL = 30;
const TAU = Math.PI * 2;

const ZB = 14; // bedplate top
const ZS = 56; // shaft centre
const BED: k.Plan = { x: -164, y: -46, w: 316, d: 116, r: 6 };

const solid = k.solidSvg;
const line = k.lineSvg;
const X: P3 = [1, 0, 0];

export type SensorGeo = ReturnType<typeof buildRig>;

export function buildRig(blades: number) {
  const P = k.fitProjection([...k.boxCorners(BED, 0, ZB), [-150, 0, ZS + 44], [130, 0, ZS + 34]], W, H, { pad: 26, azimuth: AZ, elevation: EL });
  const V = G.viewOf(P);
  const along = (x: number) => G.frameOf([x, 0, ZS], X, [0, 1, 0], [0, 0, 1]);
  const out: string[] = [];

  // ── Bedplate on rubber mounts ───────────────────────────────────────────
  out.push(`<path class="iso-halo" d="${k.haloOf(BED, 0, 8, P)}"/>`);
  const mounts = [...k.corners(BED, 16)].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
  for (const [x, y] of mounts) {
    out.push(solid(k.cylinder(x, y, 9, 0, 2, P, 32), { tone: "lo" }));
    out.push(solid(k.cylinder(x, y, 7.4, 2, 4, P, 32), { tone: "lo", inner: line(k.sideArc(x, y, 7.4, 4, P, 20), { tone: "faint" }) }));
  }
  out.push(solid(k.slabOf(BED, 6, ZB - 6, P, 6, 1.4), { tone: "mid", inner: line(k.sideSeam(BED, 10, P, 6), { tone: "faint" }) }));
  out.push(line(k.planOutline(k.insetPlan(BED, 5), ZB, P, 6), { tone: "faint" }));
  for (const [x, y] of k.corners(BED, 16)) {
    out.push(solid(k.cylinder(x, y, 3.2, ZB, 1.4, P, 6), { tone: "mid", crease: "none" }));
    out.push(k.dotsSvg([k.iso([x, y, ZB + 1.4], P)], { size: 0.45, tone: "mid" }));
  }
  // Ruler strip along the front edge, for lining up the feet.
  const RULE: k.Plan = { x: -150, y: BED.y + BED.d - 13, w: 288, d: 6, r: 1 };
  out.push(solid(k.slabOf(RULE, ZB, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(RULE.x + 4, RULE.x + RULE.w - 4, 4, 5, RULE.y + 0.4, ZB + 0.6, [1.8, 3.4], P);
  out.push(line(ticks.minor, { tone: "lo" }), line(ticks.major, { tone: "mid" }));

  // ── Motor ───────────────────────────────────────────────────────────────
  for (const fx of [-126, -80]) {
    const FOOT: k.Plan = { x: fx, y: -30, w: 18, d: 60, r: 2 };
    out.push(solid(k.slabOf(FOOT, ZB, 5, P, 3, 0.5), { tone: "mid" }));
    for (const fy of [-24, 24]) {
      out.push(solid(k.cylinder(fx + 9, fy, 3, ZB + 5, 2.4, P, 6), { tone: "mid", crease: "none" }));
      out.push(k.dotsSvg([k.iso([fx + 9, fy, ZB + 7.4], P)], { size: 0.4, tone: "mid" }));
    }
    out.push(solid(k.slabOf({ x: fx + 4, y: -18, w: 10, d: 36, r: 1.5 }, ZB + 5, 14, P, 3), { tone: "lo" }));
  }
  const cowl = G.lathe([[0, 0], [0, 17], [1.4, 22, 1], [3.4, 24.6, 1], [5.6, 25.4, 1], [14, 25.4], [14, 0]], along(-150), P);
  const slots = G.ribsOf(along(-150), 6.5, 12.5, 25.4, 30, P, { fade: [0.06, 0.5], seams: true }) as G.Faded[];
  out.push(solid(cowl, { tone: "mid", inner: k.fadedSvg(slots, { tone: "lo" }) }));
  const body = G.disc(0, 78, 27, along(-136), P);
  const fins = G.ribsOf(along(-136), 3, 75, 27, 30, P, { fade: [0.05, 0.5], seams: true }) as G.Faded[];
  out.push(solid(body, { tone: "mid", inner: k.fadedSvg(fins, { tone: "lo" }) }));
  out.push(solid(G.disc(0, 7, 24.5, along(-58), P, { bevel: 0.6 }), { tone: "mid" }));
  out.push(k.dotsSvg(G.dotsOf(along(-51), 0, 20, 6, P, { fade: [0.05, 0.42], all: false }), { size: 0.45, tone: "mid" }));
  out.push(solid(G.disc(0, 4, 12, along(-51), P), { tone: "lo" }));
  // Terminal box on a pad on top, its lid screwed down, a gland on the front.
  const TB: k.Plan = { x: -112, y: -14, w: 26, d: 28, r: 2 };
  out.push(solid(k.slabOf(k.insetPlan(TB, -2), ZS + 22, 5, P, 4), { tone: "lo" }));
  out.push(solid(k.slabOf(TB, ZS + 27, 12, P, 4, 0.6), { tone: "mid", inner: line(k.sideSeam(TB, ZS + 33, P, 4), { tone: "faint" }) }));
  out.push(solid(k.slabOf(k.insetPlan(TB, 1.4), ZS + 39, 1.6, P, 4, 0.4), { tone: "mid" }));
  out.push(k.dotsSvg(k.corners(TB, 4).map(([x, y]) => k.iso([x, y, ZS + 40.6], P)), { size: 0.45, tone: "mid" }));
  const gland = G.frameAlong([-99, 14, ZS + 33], [0, 1, 0]);
  out.push(solid(G.disc(0, 3, 4.4, gland, P), { tone: "mid" }), solid(G.disc(3, 7, 3, gland, P), { tone: "lo" }));
  out.push(line(G.circleOf(gland, 7, 1.6, P), { tone: "faint" }));
  out.push(solid(G.disc(-47, -32, 5, along(0), P), { tone: "hi" }));

  // ── Coupling hubs (the spider is drawn live, it turns) ──────────────────
  const motorHub = solid(G.disc(-32, -22, 12.5, along(0), P, { bevel: 0.5 }), { tone: "mid" });
  const pumpHub = solid(G.disc(-19, -9, 12.5, along(0), P, { bevel: 0.5 }), { tone: "mid" });

  // ── Pillow blocks ───────────────────────────────────────────────────────
  const block = (x0: number, drive: boolean) => {
    const s: string[] = [];
    const BASE: k.Plan = { x: x0 - 4, y: -32, w: 32, d: 64, r: 2.4 };
    s.push(solid(k.slabOf(BASE, ZB, 7, P, 4, 0.6), { tone: "mid" }));
    for (const by of [-24, 24]) {
      s.push(solid(k.cylinder(x0 + 12, by, 5, ZB + 7, 1, P, 20), { tone: "lo", crease: "none" }));
      s.push(solid(k.cylinder(x0 + 12, by, 3.4, ZB + 8, 3, P, 6), { tone: "mid", crease: "none" }));
    }
    s.push(solid(k.slabOf({ x: x0 + 2, y: -15, w: 20, d: 30, r: 2 }, ZB + 7, ZS - ZB - 14, P, 4), { tone: "mid" }));
    const F = along(x0);
    s.push(solid(G.disc(-2, 0, 9, F, P), { tone: "lo" }));
    const split = k.segment([x0, 20.6, ZS], [x0 + 24, 20.6, ZS], P);
    s.push(solid(G.disc(0, 24, 20.6, F, P), { tone: drive ? "hi" : "mid", inner: line(split, { tone: "faint" }) }));
    s.push(k.dotsSvg(k.pointsAt([[x0 + 4, 18.4, ZS + 8], [x0 + 20, 18.4, ZS + 8]], P), { size: 0.5, tone: "mid" }));
    s.push(solid(k.cylinder(x0 + 12, 0, 1.7, ZS + 20.4, 3, P, 6), { tone: "mid", crease: "none" }));
    s.push(solid(G.sphereOf([x0 + 12, 0, ZS + 24.6], 1.8, P), { tone: "mid" }));
    s.push(solid(G.disc(24, 26, 9, F, P), { tone: "lo" }));
    return s.join("");
  };
  const DE = 8;
  const NDE = 70;

  // ── Fan: hub and nose; the blades are drawn live ────────────────────────
  const FAN = 114;
  const hub = solid(G.lathe([[0, 0], [0, 9], [8, 9], [11, 6, 1], [13, 2.4, 1], [13.6, 0]], along(FAN), P), { tone: "mid" });

  // ── Phone, parking disc, infrared sensor on a magnetic arm ──────────────
  const PHONE: k.Plan = { x: -66, y: 36, w: 40, d: 20, r: 3.4 };
  const front: string[] = [];
  front.push(`<path class="iso-halo" d="${k.haloOf(PHONE, ZB, 1, P)}"/>`);
  front.push(solid(k.slabOf(PHONE, ZB, 2.4, P, 6, 0.6), { tone: "mid" }));
  front.push(`<path class="fx-screen" d="${k.planOutline(k.insetPlan(PHONE, 1.6), ZB + 2.4, P, 6)}"/>`);
  const port: P3 = [PHONE.x + PHONE.w, PHONE.y + PHONE.d / 2, ZB + 1.2];
  const PARK: P3 = [-10, 46, ZB];
  front.push(solid(k.cylinder(PARK[0], PARK[1], 8.4, ZB, 1.6, P, 32, 0.4), { tone: "lo" }));
  const screen: P3 = [PHONE.x + PHONE.w / 2, PHONE.y + PHONE.d / 2, ZB + 2.4];

  // Magnetic arm stand with the infrared sensor, aimed at the drive-end housing.
  const STAND: k.Plan = { x: 46, y: 44, w: 16, d: 14, r: 2 };
  front.push(solid(k.slabOf(STAND, ZB, 10, P, 4, 0.6), { tone: "mid", inner: line(k.sideSeam(STAND, ZB + 5, P, 4), { tone: "faint" }) }));
  front.push(solid(k.cylinder(STAND.x + 12, STAND.y + 7, 2.6, ZB + 10, 2, P, 16), { tone: "lo" }));
  const postAt: k.Plane = [STAND.x + 6, STAND.y + 7];
  front.push(solid(k.cylinder(postAt[0], postAt[1], 1.8, ZB + 10, ZS - ZB - 4, P, 16), { tone: "mid", crease: "none" }));
  const target: P3 = [DE + 12, 20.6 * Math.cos(0.5), ZS + 20.6 * Math.sin(0.5)];
  const lensAt: P3 = [postAt[0] - 2, postAt[1] - 6, ZS + 8];
  const aim = G.unit3(G.sub3(target, lensAt));
  const ir = G.frameAlong(lensAt, aim);
  front.push(solid(k.cylinder(postAt[0], postAt[1], 3.2, ZS + 2, 5, P, 20), { tone: "mid" }));
  front.push(solid(G.lathe([[-30, 0], [-30, 5], [-28, 6.4, 1], [-5, 6.4], [-5, 0]], ir, P), { tone: "mid", inner: line(G.arcOf(ir, -20, 6.4, P), { tone: "faint" }) }));
  front.push(solid(G.disc(-5, 0, 5.4, ir, P), { tone: "mid", className: "fig-pickup" }));
  if (G.dot3(aim, V) > 0) front.push(line(G.circleOf(ir, 0, 3.2, P), { tone: "lit", className: "fx-lens" }));
  const beam = `<path class="fx-beam" d="${k.pathOf([k.iso(G.pointOf(ir, 0.6, 0, 0), P), k.iso(target, P)])}"/>`;
  const spotF = G.frameAlong(target, G.unit3([0, Math.cos(0.5), Math.sin(0.5)]));
  const spot = `<path class="fx-spot" d="${G.circleOf(spotF, 0.2, 3.4, P)}"/>`;

  // ── Spots the pickup is carried to ──────────────────────────────────────
  const SPOTS: Record<Spot | "park", P3> = {
    park: [PARK[0], PARK[1], ZB + 1.6],
    housing: [DE + 12, 0, ZS + 20.2],
    foot: [DE + 2, 25, ZB + 7],
    aim: [PARK[0], PARK[1], ZB + 1.6],
  };

  /** The pickup at a world point: magnet base, hex body, connector on top. */
  function pickup(at: P3) {
    const [x, y, z] = at;
    const hex = (r: number) => Array.from({ length: 6 }, (_, i) => [x + r * Math.cos((i / 6) * TAU + 0.3), y + r * Math.sin((i / 6) * TAU + 0.3)] as k.Plane);
    return (
      `<path class="iso-halo" d="${k.cylinder(x, y, 7, z, 1, P, 24).fill}" style="opacity:.35"/>` +
      solid(k.cylinder(x, y, 6.6, z, 3.4, P, 32, 0.4), { tone: "lo" }) +
      solid(k.extrude(hex(5.4), z + 3.4, 11, P, { bevel: 0.5 }), { tone: "mid", className: "fig-pickup" }) +
      solid(k.cylinder(x, y, 2.6, z + 14.4, 3, P, 16), { tone: "mid" })
    );
  }
  /** The lead from the pickup's connector to the phone's port, hanging in a smooth curve. */
  function lead(at: P3) {
    const a: P3 = [at[0], at[1], at[2] + 17.4];
    const lift: P3 = [a[0], a[1], a[2] + 6];
    const b: P3 = [port[0] + 6, port[1], port[2]];
    const mid: P3 = [(lift[0] + b[0]) / 2, Math.max(lift[1], b[1]) + 14, Math.max(lift[2], b[2]) + 4];
    const curve: P3[] = Array.from({ length: 21 }, (_, i) => {
      const t = i / 20;
      const u = 1 - t;
      return [u * u * lift[0] + 2 * u * t * mid[0] + t * t * b[0], u * u * lift[1] + 2 * u * t * mid[1] + t * t * b[1], u * u * lift[2] + 2 * u * t * mid[2] + t * t * b[2]];
    });
    const route = [a, ...curve, port];
    return tubePieces(route, 1.1, P, { maxLength: 400 }).map((p) => tubeSvg(p, { tone: "mid" })).join("");
  }
  /** Fan blades at a turn angle. */
  function fan(angle: number) {
    const F = along(FAN + 4);
    const s: string[] = [];
    for (let i = 0; i < blades; i++) {
      const a = angle + (i / blades) * TAU;
      const c = Math.cos(a);
      const n = Math.sin(a);
      const shape: [number, number][] = [
        [7, -4.4],
        [31, -8.6],
        [33.4, -4],
        [33.4, 4],
        [31, 8.6],
        [7, 4.4],
      ].map(([r, w]) => [r * c - w * n, r * n + w * c]);
      const key = G.dot3(G.pointOf(F, 0, 20, a), V);
      s.push(`${key}|${solid(G.prismOf(F, shape, -1.2, 1.2, P), { tone: "hi" })}`);
    }
    return s
      .sort((p, q) => parseFloat(p) - parseFloat(q))
      .map((x) => x.slice(x.indexOf("|") + 1))
      .join("");
  }
  /** The coupling spider and the hubs' key marks at a turn angle. */
  function coupling(angle: number) {
    const F = along(0);
    const jaws = G.ribsOf(F, -22, -19, 11.4, 6, P, { phase: angle, fade: [0.05, 0.4] }) as G.Faded[];
    return (
      motorHub +
      solid(G.disc(-22, -19, 11.4, F, P), { tone: "lo", inner: k.fadedSvg(jaws, { tone: "mid" }) }) +
      pumpHub +
      line(k.pathOf([k.iso(G.pointOf(F, -19, 12.5, angle), P), k.iso(G.pointOf(F, -9, 12.5, angle), P)]), { tone: G.facingOf(F, angle, P) > 0.1 ? "lit" : "faint" })
    );
  }
  /** A progress ring on the phone's screen: 0 to 1. */
  function ring(f: number) {
    if (f <= 0) return "";
    const n = Math.max(2, Math.ceil(48 * f));
    const pts = Array.from({ length: n + 1 }, (_, i) => {
      const a = -Math.PI / 2 + (i / n) * TAU * Math.min(1, f);
      return k.iso([screen[0] + 6.2 * Math.cos(a), screen[1] + 6.2 * Math.sin(a), screen[2]], P);
    });
    return k.pathOf(pts);
  }

  return {
    P,
    label: `A motor driving a ${blades}-blade fan through a coupling and two bearing blocks on a bedplate. A phone lies in front with a vibration pickup on a lead; an infrared sensor stands on a magnetic arm.`,
    back: out.join(""),
    shaftA: solid(G.disc(-9, DE, 5, along(0), P), { tone: "hi" }),
    blockDE: block(DE, true),
    shaftB: solid(G.disc(DE + 26, NDE - 2, 5, along(0), P), { tone: "hi" }),
    blockNDE: block(NDE, false),
    shaftC: solid(G.disc(NDE + 26, FAN, 5, along(0), P), { tone: "hi" }),
    hub,
    front: front.join(""),
    beam: beam + spot,
    spots: SPOTS,
    pickup,
    lead,
    fan,
    coupling,
    ring,
  };
}
