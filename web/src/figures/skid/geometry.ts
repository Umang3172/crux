// A motor driving a centrifugal pump on a steel channel base, as the vibration
// demo clip shows it: the base on a concrete plinth, open steel channels along
// both sides with anchor studs standing in the front one, the motor on its own
// plate with four foot bolts, a bare coupling, the pump's bearing frame and
// casing, a suction pipe through a gate valve at the far end, and a discharge
// rising from the top through a flanged valve. The motor and one anchor nut are
// drawn apart from the rest, so the motor can shake and that nut can work loose.
//
// Sizes are proportions, not dimensions: no length on screen is read as a
// number. The camera looks at the motor's fan end and its front side (-y), as
// the clip does; it can turn a little (`az`), so the figure is rebuilt for an
// azimuth, and within AZ_RANGE the painter's order below holds.

import * as k from "../kit/iso-kit";
import * as G from "../kit/lathe.mjs";
import type { PartId } from "./model";

type P3 = k.Point3;

export const W = 600;
export const H = 360;
export const AZ_REST = -62;
export const AZ_RANGE: [number, number] = [-76, -48];
const EL = 24;

const solid = k.solidSvg;
const line = k.lineSvg;

// World: x along the shaft (motor toward +x, its fan end nearest the viewer),
// y across with the front at -y, z up.
const PLINTH: k.Plan = { x: -196, y: -66, w: 360, d: 132, r: 2 };
const BASE: k.Plan = { x: -150, y: -46, w: 296, d: 92, r: 0 };
const ZP = 16; // plinth top
const ZB = ZP + 14; // channel tops
const CH_D = 10; // channel depth across y
const LIP = 2; // channel flange thickness
const WEB = 1.6;
const ZM = ZB + 4; // motor and pump plates' top
const ZS = 80; // shaft centre
const RM = 30; // motor frame
const MX0 = 24; // motor drive end
const MX1 = 112; // motor far end, where the fan cover starts
const FEET = [42, 96];
const FY = 27; // bolt rows either side of the shaft
const FOOT_H = 6;
/** Anchor studs standing in the front channel; the middle one is the one that works loose. */
const STUDS = [-122, 30, 128];
const LOOSE_X = STUDS[1];
const FRONT_Y = BASE.y + CH_D / 2;

const X: P3 = [1, 0, 0];
const Y: P3 = [0, 1, 0];
const UP: P3 = [0, 0, 1];

export type SkidGeo = ReturnType<typeof buildSkid>;

export function buildSkid(az = AZ_REST) {
  const P = k.fitProjection([...k.boxCorners(PLINTH, 0, ZP), [-81, 0, 202], [-81, 50, 202], [-141, 0, ZS + 48], [MX1 + 34, 0, ZS + RM], [MX1 + 34, 0, ZS - RM]], W, H, { pad: 16, azimuth: az, elevation: EL });
  const shaft = G.frameAlong([0, 0, ZS], X);
  const up = (x: number, y: number) => G.frameAlong([x, y, 0], UP);
  const fault = (on: boolean) => (on ? { className: "fig-fault" } : {});
  const slab = (plan: k.Plan, z: number, h: number, tone: k.Tone = "mid", bevel = 0.4) => solid(k.slabOf(plan, z, h, P, 2, bevel), { tone });

  // ── Plinth, back channel, end members, front channel's web and lower lip ──
  const groundBack: string[] = [];
  groundBack.push(`<path class="iso-halo" d="${k.haloOf(PLINTH, 0, 10, P)}"/>`);
  groundBack.push(solid(k.slabOf(PLINTH, 0, ZP, P, 2, 0.8), { tone: "lo", inner: line(k.sideSeam(PLINTH, ZP - 4, P, 2), { tone: "faint" }) }));
  groundBack.push(line(k.planOutline(k.insetPlan(PLINTH, 7), ZP, P, 2), { tone: "faint" }));
  groundBack.push(solid(k.slabOf(k.insetPlan({ ...BASE, r: 2 }, -3), ZP, 1.5, P, 2, 0.3), { tone: "lo" }));
  const x0 = BASE.x;
  const x1 = BASE.x + BASE.w;
  groundBack.push(slab({ x: x0, y: BASE.y + BASE.d - CH_D, w: BASE.w, d: CH_D, r: 0 }, ZP + 1.5, ZB - ZP - 1.5));
  groundBack.push(slab({ x: x0, y: BASE.y + CH_D, w: 8, d: BASE.d - 2 * CH_D, r: 0 }, ZP + 1.5, ZB - ZP - 1.5));
  groundBack.push(slab({ x: x1 - 8, y: BASE.y + CH_D, w: 8, d: BASE.d - 2 * CH_D, r: 0 }, ZP + 1.5, ZB - ZP - 1.5));
  // The front channel opens toward the viewer: its web at the back, a lip below and above.
  groundBack.push(slab({ x: x0, y: BASE.y + CH_D - WEB, w: BASE.w, d: WEB, r: 0 }, ZP + 1.5, ZB - ZP - 1.5, "lo", 0));
  groundBack.push(slab({ x: x0, y: BASE.y, w: BASE.w, d: CH_D, r: 0 }, ZP + 1.5, LIP));
  for (const x of STUDS) if (x !== LOOSE_X) groundBack.push(anchor(x, 0, false));
  /** An anchor stud between the channel's lips: a nut and washer below, and a nut and washer up under the top lip, `drop` below it. */
  function anchor(x: number, drop: number, red: boolean) {
    const zb = ZP + 1.5 + LIP;
    const zt = ZB - LIP;
    const st = { tone: "mid" as const, crease: "none" as const, ...fault(red) };
    return (
      solid(k.cylinder(x, FRONT_Y, 1.6, zb, zt - zb, P, 12), st) +
      solid(k.cylinder(x, FRONT_Y, 3.6, zb, 0.8, P, 20), st) +
      solid(k.extrude(hex(x, FRONT_Y, 3), zb + 0.8, 2.6, P, { bevel: 0.3 }), { tone: "mid", ...fault(red) }) +
      solid(k.extrude(hex(x, FRONT_Y, 3), zt - drop - 3.4, 2.6, P, { bevel: 0.3 }), { tone: "mid", ...fault(red) }) +
      solid(k.cylinder(x, FRONT_Y, 3.6, zt - drop - 0.8, 0.8, P, 20), st)
    );
  }

  // ── The front channel's top lip, and the motor's and pump's plates ──────
  const groundFront: string[] = [];
  groundFront.push(slab({ x: x0, y: BASE.y, w: BASE.w, d: CH_D, r: 0 }, ZB - LIP, LIP));
  for (const x of STUDS) groundFront.push(k.dotsSvg([k.iso([x, FRONT_Y, ZB], P)], { size: 0.5, tone: "mid" }));
  const MPLATE: k.Plan = { x: 28, y: -44, w: 94, d: 88, r: 1 };
  const PPLATE: k.Plan = { x: -108, y: -44, w: 92, d: 88, r: 1 };
  for (const plate of [PPLATE, MPLATE]) {
    groundFront.push(solid(k.slabOf(plate, ZB, ZM - ZB, P, 2, 0.4), { tone: "mid", inner: line(k.planOutline(k.insetPlan(plate, 4), ZM, P, 2), { tone: "faint" }) }));
    groundFront.push(k.dotsSvg(k.corners(plate, 3.5).map(([x, y]) => k.iso([x, y, ZM], P)), { size: 0.45, tone: "mid" }));
  }

  // ── Suction: pipe in along the shaft through a gate valve ──────────────
  const suction: string[] = [];
  const flange = (s0: number, s1: number, r: number, F: G.Frame, bolts = 8) =>
    solid(G.disc(s0, s1, r, F, P, { bevel: 0.5 }), { tone: "mid" }) + k.dotsSvg(G.dotsOf(F, s1, r - 3.2, bolts, P, { phase: Math.PI / bolts }), { size: 0.5, tone: "mid" });
  suction.push(flange(-196, -191, 19, shaft));
  suction.push(solid(G.disc(-191, -155, 12, shaft, P), { tone: "hi" }));
  suction.push(flange(-155, -151, 19, shaft));
  suction.push(solid(G.disc(-151, -131, 15, shaft, P, { bevel: 0.6 }), { tone: "hi" }));
  // The valve's bonnet rises from its body; a stem carries the handwheel.
  const VX = -141;
  const vUp = up(VX, 0);
  suction.push(solid(G.disc(ZS + 10, ZS + 30, 7, vUp, P), { tone: "mid" }));
  suction.push(flange(ZS + 30, ZS + 33, 9.5, vUp, 6));
  suction.push(solid(G.disc(ZS + 33, ZS + 47, 1.6, vUp, P), { tone: "mid" }));
  const wheelZ = ZS + 46;
  suction.push(`<path class="fx-wheel" d="${G.circleOf(vUp, wheelZ, 12, P)}"/>`);
  suction.push(line(G.spokesOf(vUp, wheelZ, 3, 12, 5, P, { phase: 0.4 }), { tone: "mid" }));
  suction.push(solid(G.disc(wheelZ - 1.5, wheelZ + 2, 3, vUp, P, { bevel: 0.4 }), { tone: "mid" }));
  suction.push(flange(-131, -127, 19, shaft));
  suction.push(flange(-127, -122, 19, shaft));
  suction.push(solid(G.disc(-122, -104, 12, shaft, P), { tone: "hi" }));

  // ── Pump: casing on its foot, discharge with a valve, bearing frame ────
  const pump: string[] = [];
  pump.push(slab({ x: -94, y: -24, w: 28, d: 48, r: 1.5 }, ZM, ZS - 36 - ZM + 2, "mid", 0.5));
  for (const y of [-18, 18]) pump.push(k.dotsSvg([k.iso([-80, y, ZS - 34], P)], { size: 0.5, tone: "mid" }));
  // The discharge's far run is behind everything else on the pump, so it goes first.
  const DX = -81;
  const away = G.frameAlong([DX, 0, 190], Y);
  pump.push(flange(40, 45, 17, away));
  pump.push(solid(G.disc(0, 40, 10, away, P), { tone: "hi" }));
  const casing = G.disc(-100, -62, 36, shaft, P, { bevel: 0.8 });
  const casingRim = k.fadedSvg(G.ribsOf(shaft, -100, -62, 36, 2, P, { fade: [0.05, 0.4] }) as G.Faded[], { tone: "lo" });
  pump.push(`<g data-part="casing">${solid(casing, { tone: "hi", inner: casingRim })}</g>`);
  pump.push(solid(G.disc(-104, -100, 32, shaft, P, { bevel: 0.6 }), { tone: "mid" }));
  pump.push(k.dotsSvg(G.dotsOf(shaft, -104, 28, 12, P), { size: 0.5, tone: "mid" }));
  pump.push(k.dotsSvg(G.dotsOf(shaft, -62, 33, 12, P, { phase: 0.26 }), { size: 0.5, tone: "mid" }));
  const dUp = up(DX, 0);
  pump.push(solid(G.disc(ZS + 28, ZS + 44, 11, dUp, P), { tone: "hi" }));
  pump.push(flange(ZS + 44, ZS + 48, 17, dUp));
  pump.push(flange(ZS + 48, ZS + 52, 17, dUp));
  pump.push(solid(G.disc(ZS + 52, ZS + 64, 14, dUp, P, { bevel: 0.6 }), { tone: "mid" }));
  pump.push(flange(ZS + 64, ZS + 68, 17, dUp));
  pump.push(solid(G.disc(ZS + 68, 190, 10, dUp, P), { tone: "hi" }));
  pump.push(solid(G.disc(166, 171, 11.4, dUp, P, { bevel: 0.4 }), { tone: "mid" }));
  pump.push(solid(G.sphereOf([DX, 0, 190], 11.6, P), { tone: "hi" }));

  // Bearing frame on its pedestal, with an oil sight glass on the front.
  const frame: string[] = [];
  const PED: k.Plan = { x: -60, y: -20, w: 36, d: 40, r: 1.5 };
  frame.push(solid(k.slabOf(PED, ZM, ZS - ZM - 12, P, 2, 0.5), { tone: "mid", inner: line(k.sideSeam(PED, ZM + 8, P, 2), { tone: "faint" }) }));
  frame.push(solid(G.disc(-62, -20, 15, shaft, P, { bevel: 0.6 }), { tone: "hi" }));
  frame.push(k.dotsSvg(G.dotsOf(shaft, -20, 12, 6, P), { size: 0.45, tone: "mid" }));
  const glass = G.frameAlong([-40, -15, ZS - 4], [0, -1, 0]);
  frame.push(solid(G.disc(0, 2, 3.4, glass, P), { tone: "mid" }));
  frame.push(`<path class="fx-glass" d="${G.circleOf(glass, 2, 2.2, P)}"/>`);

  // ── Coupling: two hubs and the flexible ring between them, bare ────────
  const coupling: string[] = [];
  coupling.push(solid(G.disc(-20, -14, 4.6, shaft, P), { tone: "hi" }));
  coupling.push(solid(G.disc(-14, -5, 10, shaft, P, { bevel: 0.6 }), { tone: "hi" }));
  coupling.push(k.dotsSvg(G.dotsOf(shaft, -5, 8.6, 6, P), { size: 0.45, tone: "mid" }));
  coupling.push(solid(G.disc(-5, -3, 7.4, shaft, P), { tone: "lo" }));
  coupling.push(`<g data-part="coupling">${solid(G.disc(-3, 7, 10, shaft, P, { bevel: 0.6 }), { tone: "hi" })}</g>`);
  coupling.push(solid(G.disc(7, MX0 - 7, 4.6, shaft, P), { tone: "hi" }));

  // ── Motor: feet, body with fins, end shields, fan cover, terminal box ──
  const tightBack: string[] = [];
  const tightFront: string[] = [];
  const motor: string[] = [];
  for (const fx of FEET) {
    motor.push(solid(k.slabOf({ x: fx - 9, y: -FY - 7, w: 18, d: (FY + 7) * 2, r: 1.5 }, ZM, FOOT_H, P, 2, 0.5), { tone: "mid" }));
    motor.push(solid(k.slabOf({ x: fx - 6, y: -16, w: 12, d: 32, r: 1 }, ZM + FOOT_H, ZS - RM - ZM - FOOT_H + 6, P, 2), { tone: "mid" }));
  }
  for (const fx of FEET) {
    tightBack.push(bolt(fx, FY, ZM + FOOT_H, P));
    tightFront.push(bolt(fx, -FY, ZM + FOOT_H, P));
  }

  motor.push(solid(G.disc(MX0 - 7, MX0, RM - 3, shaft, P, { bevel: 0.6 }), { tone: "mid" }));
  motor.push(k.dotsSvg(G.dotsOf(shaft, MX0 - 7, RM - 6, 6, P), { size: 0.45, tone: "mid" }));
  const fins = G.ribsOf(shaft, MX0 + 3, MX1 - 3, RM, 28, P, { fade: [0.05, 0.5], seams: true }) as G.Faded[];
  motor.push(`<g data-part="motor">${solid(G.disc(MX0, MX1, RM, shaft, P), { tone: "hi", inner: k.fadedSvg(fins, { tone: "lo" }) })}</g>`);
  motor.push(solid(G.disc(MX1, MX1 + 6, RM - 2, shaft, P, { bevel: 0.6 }), { tone: "mid" }));
  // The fan cover: slots round its side, a grille of holes over its end.
  const cowlF = G.frameAlong([MX1 + 6, 0, ZS], X);
  const cowl = G.lathe([[0, 0], [0, RM - 3], [16, RM - 3], [22, RM - 6, 1], [26, RM - 12, 1], [28, 0]], cowlF, P);
  const slots = G.ribsOf(cowlF, 3, 15, RM - 3, 30, P, { fade: [0.06, 0.5], seams: true }) as G.Faded[];
  const holes: Array<k.Flat | P3> = [];
  for (const r of [4, 8, 12, 16]) holes.push(...G.dotsOf(cowlF, 28 - (r / (RM - 12)) * 2, r, Math.round(r * 1.6), P, { all: true, phase: r * 0.3 }));
  motor.push(solid(cowl, { tone: "mid", inner: k.fadedSvg(slots, { tone: "lo" }) + k.dotsSvg(holes, { size: 0.45, tone: "lo" }) }));
  // Terminal box toward the drive end, its cable gland on the front.
  const TB: k.Plan = { x: 38, y: -15, w: 28, d: 30, r: 2 };
  motor.push(solid(k.slabOf(k.insetPlan(TB, -2), ZS + RM - 4, 6, P, 4), { tone: "lo" }));
  motor.push(solid(k.slabOf(TB, ZS + RM + 2, 13, P, 4, 0.6), { tone: "mid", inner: line(k.sideSeam(TB, ZS + RM + 8, P, 4), { tone: "faint" }) }));
  motor.push(k.dotsSvg(k.corners(TB, 4).map(([x, y]) => k.iso([x, y, ZS + RM + 15], P)), { size: 0.45, tone: "mid" }));
  const gland = G.frameAlong([52, TB.y, ZS + RM + 8], [0, -1, 0]);
  motor.push(solid(G.disc(0, 3, 4.4, gland, P), { tone: "mid" }), solid(G.disc(3, 7, 3, gland, P), { tone: "lo" }));
  // The lifting eye on top, toward the fan end.
  motor.push(solid(G.disc(ZS + RM - 3, ZS + RM + 2, 3.6, up(84, 0), P, { bevel: 0.4 }), { tone: "mid" }));
  motor.push(`<path class="fx-eye" d="${G.circleOf(G.frameAlong([84, 0, ZS + RM + 7.5], Y), 0, 5, P)}"/>`);
  // A nameplate on the side facing the viewer, its rule lines standing for text.
  const plateY = -RM * 0.72;
  const plateZ = ZS + RM * 0.69;
  motor.push(line(k.segment([70, plateY, plateZ], [90, plateY, plateZ], P) + k.segment([70, plateY, plateZ - 4], [86, plateY, plateZ - 4], P), { tone: "lo", free: true }));

  /** The anchor that works loose: its nut and washer `drop` below the channel's lip. */
  function looseBolt(drop: number, red: boolean) {
    return anchor(LOOSE_X, drop, red);
  }

  /** The motor, with its frame drawn red when the motor is what the scan points at. */
  function motorSvg(part: PartId | null) {
    return motor.map((s) => (part === "motor" && s.includes('data-part="motor"') ? s.replace('class="iso-solid"', 'class="iso-solid fig-fault"') : s)).join("");
  }

  function pumpSvg(part: PartId | null) {
    const mark = (s: string, id: string) => (part === id ? s.replace(/data-part="[a-z]+">(<g class=")iso-solid"/, `data-part="${id}">$1iso-solid fig-fault"`) : s);
    return {
      suction: suction.join(""),
      pump: pump.map((s) => mark(s, "casing")).join(""),
      frame: frame.join(""),
      coupling: coupling.map((s) => mark(s, "coupling")).join(""),
    };
  }

  /** Screen offset for the motor moving `dy` across the shaft and `dz` up, world units. */
  function shift(dy: number, dz: number): [number, number] {
    const a = k.iso([0, dy, dz], P);
    const o = k.iso([0, 0, 0], P);
    return [a[0] - o[0], a[1] - o[1]];
  }

  return {
    P,
    label:
      "A motor driving a centrifugal pump on a steel channel base on a concrete plinth: anchor studs stand in the front channel, four bolts hold the motor's feet, a bare coupling joins the shafts, a suction pipe enters the pump's far end through a gate valve and a discharge pipe rises from its top through a flanged valve.",
    groundBack: groundBack.join(""),
    groundFront: groundFront.join(""),
    tightBack: tightBack.join(""),
    tightFront: tightFront.join(""),
    motorSvg,
    pumpSvg,
    looseBolt,
    shift,
  };
}

function hex(x: number, y: number, r: number): k.Plane[] {
  return Array.from({ length: 6 }, (_, i) => [x + r * Math.cos((i / 6) * Math.PI * 2 + 0.3), y + r * Math.sin((i / 6) * Math.PI * 2 + 0.3)] as k.Plane);
}

/** A tight hold-down bolt: washer, nut, and the stud's end. */
function bolt(x: number, y: number, z: number, P: k.Projection) {
  return (
    solid(k.cylinder(x, y, 4.4, z, 1, P, 20), { tone: "mid", crease: "none" }) +
    solid(k.extrude(hex(x, y, 3.4), z + 1, 3, P, { bevel: 0.4 }), { tone: "mid" }) +
    solid(k.cylinder(x, y, 1.5, z + 4, 1.2, P, 12), { tone: "mid", crease: "none" })
  );
}
