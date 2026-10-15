// An end-suction pump driven by a finned motor, as the clean demo clip shows
// them: both on a coated floor, the pump on a sole plate with a foot under its
// casing and another under its bearing bracket, the motor's feet bolted to a
// fabricated base frame anchored at its corners. The suction comes in along the
// shaft into the casing's eye; the discharge rises from the casing's top
// through a flange pair and turns away. The bearing bracket is a lantern with
// windows top and bottom, so the shaft shows through it; a bare jaw coupling
// joins the shafts. The motor has a terminal box with a plugged gland on top, a
// lifting eye, a nameplate on a cast pad and a fan cover at its far end.
//
// Sizes are proportions, not dimensions: no length on screen is read as a
// number. The camera stands in front (+y) and a little toward the pump, as the
// clip does, so the motor's drive-end shield shows; it can turn a little (`az`),
// and within AZ_RANGE the painter's order below holds: along the shaft, a part
// further toward +x is further from the viewer and is drawn first.

import * as k from "../kit/iso-kit";
import * as G from "../kit/lathe.mjs";
import type { PartId } from "./model";

type P3 = k.Point3;

export const W = 600;
export const H = 360;
export const AZ_REST = 104;
export const AZ_RANGE: [number, number] = [92, 118];
const EL = 22;

const solid = k.solidSvg;
const line = k.lineSvg;

// World: x along the shaft (motor toward +x), y across with the front at +y, z up.
const FLOOR: k.Plan = { x: -230, y: -64, w: 372, d: 128, r: 2 };
const ZF = 5; // floor top
const ZS = 74; // shaft centre

// Pump.
const RC = 40; // casing
const CX0 = -152; // casing's suction face
const CX1 = -114; // casing's back
const DX = -133; // discharge centre
const ZTOP = 196; // where the discharge turns away
const SOLE: k.Plan = { x: -164, y: -30, w: 98, d: 60, r: 1 };
const ZSOLE = ZF + 4;

// Coupling and motor.
const RM = 33; // motor frame
const MX0 = -26; // drive-end shield's outer face
const MX1 = 74; // fan-end shield
const FEET = [0, 54];
const FY = 26; // foot bolt rows either side of the shaft
const RAIL_D = 12;
const ZR = ZF + 12; // base frame's top
const FOOT_H = 6;
const RAIL_X0 = -22;
const RAIL_X1 = 102; // runs on under the fan cover

const X: P3 = [1, 0, 0];
const Y: P3 = [0, 1, 0];
const UP: P3 = [0, 0, 1];

export type PumpsetGeo = ReturnType<typeof buildPumpset>;

export function buildPumpset(az = AZ_REST, part: PartId | null = null) {
  const P = k.fitProjection([...k.boxCorners(FLOOR, 0, ZF), [DX, 0, ZTOP + 14], [DX, -52, ZTOP + 14], [MX1 + 34, 0, ZS + RM], [MX1 + 34, 0, ZS - RM]], W, H, { pad: 16, azimuth: az, elevation: EL });
  const shaft = G.frameAlong([0, 0, ZS], X);
  const up = (x: number, y: number) => G.frameAlong([x, y, 0], UP);
  const red = (id: PartId) => (part === id ? { className: "fig-fault" } : {});
  const slab = (plan: k.Plan, z: number, h: number, tone: k.Tone = "mid", bevel = 0.4, extra = {}) => solid(k.slabOf(plan, z, h, P, 2, bevel), { tone, ...extra });
  /** A flange from s0 to s1; its bolt heads go on `face`, the face the viewer sees, or nowhere when it is clamped to its pair. */
  const flange = (s0: number, s1: number, r: number, F: G.Frame, face: number | null, bolts = 8) =>
    solid(G.disc(s0, s1, r, F, P, { bevel: 0.5 }), { tone: "mid" }) + (face === null ? "" : k.dotsSvg(G.dotsOf(F, face, r - 3.4, bolts, P, { all: true, phase: Math.PI / bolts }), { size: 0.5, tone: "mid" }));
  const nut = (x: number, y: number, z: number) => bolt(x, y, z, P);

  // ── Floor: coated slab, its border groove and one saw-cut joint ─────────
  const floor: string[] = [];
  floor.push(`<path class="iso-halo" d="${k.haloOf(FLOOR, 0, 8, P)}"/>`);
  floor.push(solid(k.slabOf(FLOOR, 0, ZF, P, 2, 0.6), { tone: "lo", inner: line(k.sideSeam(FLOOR, ZF - 1.6, P, 2), { tone: "faint" }) }));
  floor.push(line(k.planOutline(k.insetPlan(FLOOR, 6), ZF, P, 2), { tone: "faint" }));
  floor.push(line(k.lineOnTop([-48, FLOOR.y + 6], [-48, FLOOR.y + FLOOR.d - 6], ZF, P), { tone: "faint" }));

  // ── Motor base frame: two rails, end members, four anchors ─────────────
  const base: string[] = [];
  const RAIL_W = RAIL_X1 - RAIL_X0;
  const rail = (y: number) => slab({ x: RAIL_X0, y: y - RAIL_D / 2, w: RAIL_W, d: RAIL_D, r: 0 }, ZF, ZR - ZF, "mid", 0.5, { inner: line(k.sideSeam({ x: RAIL_X0, y: y - RAIL_D / 2, w: RAIL_W, d: RAIL_D, r: 0 }, ZR - 3, P, 2), { tone: "faint" }), ...red("base") });
  base.push(rail(-FY));
  for (const x of [RAIL_X1 - 8, RAIL_X0]) base.push(slab({ x, y: -FY + RAIL_D / 2, w: 8, d: 2 * FY - RAIL_D, r: 0 }, ZF, ZR - ZF - 3, "mid", 0.4, red("base")));
  base.push(rail(FY));
  const ANCHOR_X = [RAIL_X0 + 5, RAIL_X1 - 5];
  const anchorsBack = ANCHOR_X.map((x) => nut(x, -FY, ZR)).join("");
  const anchorsFront = ANCHOR_X.map((x) => nut(x, FY, ZR)).join("");

  // ── Motor: feet, end shields, finned frame, fan cover, terminal box ────
  const motorBack: string[] = [];
  const motor: string[] = [];
  const motorFront: string[] = [];
  for (const fx of FEET) {
    motorBack.push(solid(k.slabOf({ x: fx - 9, y: -FY - 6, w: 18, d: (FY + 6) * 2, r: 1.5 }, ZR, FOOT_H, P, 2, 0.5), { tone: "mid" }));
    motorBack.push(solid(k.slabOf({ x: fx - 6, y: -15, w: 12, d: 30, r: 1 }, ZR + FOOT_H, ZS - RM - ZR - FOOT_H + 6, P, 2), { tone: "mid" }));
  }
  for (const fx of FEET) motorBack.push(nut(fx, -FY, ZR + FOOT_H));
  for (const fx of FEET) motorFront.push(nut(fx, FY, ZR + FOOT_H));

  // The fan cover first: it is the far end. Slots round its side, holes over its end.
  const cowlF = G.frameAlong([MX1 + 6, 0, ZS], X);
  const cowl = G.lathe([[0, 0], [0, RM - 3], [16, RM - 3], [22, RM - 6, 1], [26, RM - 12, 1], [28, 0]], cowlF, P);
  const slots = G.ribsOf(cowlF, 3, 15, RM - 3, 30, P, { fade: [0.06, 0.5], seams: true }) as G.Faded[];
  motor.push(solid(cowl, { tone: "mid", inner: k.fadedSvg(slots, { tone: "lo" }) }));
  motor.push(solid(G.disc(MX1, MX1 + 6, RM - 2, shaft, P, { bevel: 0.6 }), { tone: "mid" }));
  const fins = G.ribsOf(shaft, MX0 + 10, MX1 - 3, RM, 28, P, { fade: [0.05, 0.5], seams: true }) as G.Faded[];
  motor.push(solid(G.disc(MX0 + 7, MX1, RM, shaft, P), { tone: "hi", inner: k.fadedSvg(fins, { tone: "lo" }), ...red("motor") }));
  // A cast pad on the front of the frame carries the nameplate; its rule lines stand for text.
  // The pad starts where the frame's surface is at its top edge, so none of it shows inside the frame.
  const PAD: k.Plan = { x: 24, y: 30, w: 34, d: 2.6, r: 0.6 };
  motor.push(solid(k.slabOf(PAD, ZS - 9, 23, P, 2, 0.4), { tone: "mid" }));
  const PLATE: k.Plan = { x: 26.5, y: PAD.y + PAD.d, w: 29, d: 1, r: 0 };
  motor.push(solid(k.slabOf(PLATE, ZS - 7, 19, P, 2, 0.2), { tone: "hi" }));
  const yp = PLATE.y + PLATE.d + 0.05;
  const rows = [ZS + 8, ZS + 4.5, ZS + 1.5, ZS - 1.5, ZS - 4.5];
  motor.push(line(rows.map((z, i) => k.segment([29.5, yp, z], [i % 2 ? 46 : 52, yp, z], P)).join(""), { tone: "lo", free: true }));
  motor.push(k.dotsSvg([k.iso([PLATE.x + 1.2, yp, ZS + 10.5], P), k.iso([PLATE.x + PLATE.w - 1.2, yp, ZS + 10.5], P), k.iso([PLATE.x + 1.2, yp, ZS - 5.5], P), k.iso([PLATE.x + PLATE.w - 1.2, yp, ZS - 5.5], P)], { size: 0.4, tone: "mid" }));
  // Terminal box on top, its plugged gland on the lid and a cable gland on the front.
  const TB: k.Plan = { x: 6, y: -15, w: 30, d: 30, r: 2 };
  motor.push(solid(k.slabOf(k.insetPlan(TB, -2), ZS + RM - 4, 6, P, 4), { tone: "lo" }));
  motor.push(solid(k.slabOf(TB, ZS + RM + 2, 14, P, 4, 0.6), { tone: "mid", inner: line(k.sideSeam(TB, ZS + RM + 9, P, 4), { tone: "faint" }) }));
  const lid = ZS + RM + 16;
  motor.push(k.dotsSvg(k.corners(TB, 4).map(([x, y]) => k.iso([x, y, lid], P)), { size: 0.45, tone: "mid" }));
  motor.push(solid(G.disc(lid, lid + 2, 6, up(17, 5), P, { bevel: 0.3 }), { tone: "mid" }));
  motor.push(solid(G.disc(lid + 2, lid + 6, 4.6, up(17, 5), P, { bevel: 0.6 }), { tone: "lo" }));
  const gland = G.frameAlong([28, TB.y + TB.d, ZS + RM + 8], Y);
  motor.push(solid(G.disc(0, 3, 4.4, gland, P), { tone: "mid" }), solid(G.disc(3, 7, 3, gland, P), { tone: "lo" }));
  // The lifting eye beside the box, toward the fan end.
  motor.push(solid(G.disc(ZS + RM - 3, ZS + RM + 2, 3.6, up(48, 0), P, { bevel: 0.4 }), { tone: "mid" }));
  motor.push(`<path class="fx-eye" d="${G.circleOf(G.frameAlong([48, 0, ZS + RM + 7.5], Y), 0, 5, P)}"/>`);
  // The drive-end shield faces the coupling, and the viewer: its bolts show.
  motor.push(solid(G.disc(MX0, MX0 + 7, RM - 3, shaft, P, { bevel: 0.6 }), { tone: "mid" }));
  motor.push(k.dotsSvg(G.dotsOf(shaft, MX0, RM - 6.5, 8, P, { all: true, phase: Math.PI / 8 }), { size: 0.45, tone: "mid" }));
  motor.push(solid(G.disc(MX0 - 3, MX0, 9, shaft, P, { bevel: 0.4 }), { tone: "mid" }));

  // ── Coupling: motor shaft, two jaw hubs, the spider between them ───────
  // Built far to near; the turning screws and jaws go in between (`turning`).
  const coupling = {
    motorStub: solid(G.disc(-38, MX0 - 3, 5, shaft, P), { tone: "hi" }),
    motorHub: solid(G.disc(-49, -38, 12, shaft, P, { bevel: 0.6 }), { tone: "hi", ...red("coupling") }),
    spider: solid(G.disc(-53, -49, 10.4, shaft, P), { tone: "lo", ...red("coupling") }),
    pumpHub: solid(G.disc(-64, -53, 12, shaft, P, { bevel: 0.6 }), { tone: "hi", ...red("coupling") }),
  };
  /** The parts that show the coupling turning, at shaft angle `a`: a set screw on each hub, the spider's jaws. */
  function turning(a: number) {
    return {
      motorScrew: k.dotsSvg(G.dotsOf(shaft, -43.5, 12, 1, P, { phase: a }), { size: 0.55, tone: "mid" }),
      jaws: line(G.ribsOf(shaft, -53, -49, 10.4, 6, P, { phase: a + 0.3, least: 0.15 }) as string, { tone: "mid" }),
      pumpScrew: k.dotsSvg(G.dotsOf(shaft, -58.5, 12, 1, P, { phase: a + Math.PI }), { size: 0.55, tone: "mid" }),
    };
  }

  // ── Pump: sole plate, feet, bracket, casing, discharge, suction ────────
  const pump: string[] = [];
  const pumpFront: string[] = [];
  pump.push(solid(k.slabOf(SOLE, ZF, ZSOLE - ZF, P, 2, 0.4), { tone: "mid", inner: line(k.planOutline(k.insetPlan(SOLE, 4), ZSOLE, P, 2), { tone: "faint" }), ...red("base") }));
  for (const x of [SOLE.x + 6, SOLE.x + SOLE.w - 6]) pump.push(nut(x, SOLE.y + 6, ZSOLE));
  for (const x of [SOLE.x + 6, SOLE.x + SOLE.w - 6]) pumpFront.push(nut(x, SOLE.y + SOLE.d - 6, ZSOLE));
  // The far discharge run turns away above everything else on the pump, so it goes first.
  const away = G.frameAlong([DX, 0, ZTOP], [0, -1, 0]);
  pump.push(flange(44, 49, 19, away, 44));
  pump.push(solid(G.disc(0, 44, 11, away, P), { tone: "hi", ...red("discharge") }));
  // Feet: one under the bracket, one under the casing, each on a flange bolted to the plate.
  const foot = (x: number, w: number, top: number) => {
    const fl: k.Plan = { x: x - 4, y: -23, w: w + 8, d: 46, r: 1 };
    return (
      solid(k.slabOf(fl, ZSOLE, 3, P, 2, 0.3), { tone: "mid" }) +
      nut(x + w / 2, -18, ZSOLE + 3) +
      solid(k.slabOf({ x, y: -13, w, d: 26, r: 1.5 }, ZSOLE + 3, top - ZSOLE - 3, P, 2, 0.5), { tone: "mid", inner: line(k.sideSeam({ x, y: -13, w, d: 26, r: 1.5 }, ZSOLE + 9, P, 2), { tone: "faint" }) }) +
      nut(x + w / 2, 18, ZSOLE + 3)
    );
  };
  pump.push(foot(-98, 14, ZS - 15));
  pump.push(foot(-143, 20, ZS - RC + 6));
  // The pump's shaft, the bearing housing with its grease nipple, and the lantern's windows.
  pump.push(solid(G.disc(-76, -64, 4.6, shaft, P), { tone: "hi" }));
  pump.push(solid(G.disc(-86, -76, 19, shaft, P, { bevel: 0.6 }), { tone: "mid", ...red("bracket") }));
  pump.push(k.dotsSvg(G.dotsOf(shaft, -86, 15.5, 6, P, { all: true, phase: 0.5 }), { size: 0.45, tone: "mid" }));
  pump.push(solid(G.disc(ZS + 18.5, ZS + 22, 1.5, up(-81, 0), P), { tone: "mid" }));
  pump.push(solid(G.sphereOf([-81, 0, ZS + 23.4], 1.8, P), { tone: "mid" }));
  const arc = (from: number, to: number, r0: number, r1: number): [number, number][] => {
    const n = 10;
    const outer = Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n).map((t): [number, number] => [r1 * Math.cos(t), r1 * Math.sin(t)]);
    const inner = Array.from({ length: n + 1 }, (_, i) => to - ((to - from) * i) / n).map((t): [number, number] => [r0 * Math.cos(t), r0 * Math.sin(t)]);
    return [...outer, ...inner];
  };
  const deg = Math.PI / 180;
  const arm = (a0: number, a1: number) => solid(G.prismOf(shaft, arc(a0 * deg, a1 * deg, 13, 19), -104, -86, P), { tone: "hi", ...red("bracket") });
  // Angles from the front (+y) toward the top: the back arm behind the shaft, then the shaft and its flinger, then the arms below and above.
  pump.push(arm(145, 215));
  pump.push(solid(G.disc(-104, -86, 4.6, shaft, P), { tone: "hi" }));
  pump.push(solid(G.disc(-96, -92, 7, shaft, P, { bevel: 0.3 }), { tone: "lo" }));
  pump.push(arm(235, 305));
  pump.push(arm(55, 125));
  pump.push(solid(G.disc(-110, -104, 27, shaft, P, { bevel: 0.6 }), { tone: "mid", ...red("bracket") }));
  // The casing, its back cover, and the bolts round its suction face.
  pump.push(solid(G.disc(CX1, -110, 33, shaft, P, { bevel: 0.6 }), { tone: "mid" }));
  // A cast casing: flat faces, the rim rounded over between them.
  const casing = G.lathe([[CX0, 0], [CX0, RC - 8], [CX0 + 2, RC - 3, 1], [CX0 + 8, RC, 1], [CX1 - 8, RC, 1], [CX1 - 2, RC - 3, 1], [CX1, RC - 8], [CX1, 0]], G.frameAlong([0, 0, ZS], X), P);
  const casingRim = k.fadedSvg(G.ribsOf(shaft, CX0 + 8, CX1 - 8, RC, 2, P, { fade: [0.05, 0.4] }) as G.Faded[], { tone: "lo" });
  pump.push(solid(casing, { tone: "hi", inner: casingRim, ...red("casing") }));
  pump.push(k.dotsSvg(G.dotsOf(shaft, CX0, RC - 12, 12, P, { all: true }), { size: 0.5, tone: "mid" }));
  // A drain plug low on the casing's front: a boss and a square head.
  const drainAt = -55 * (Math.PI / 180);
  const drain = G.frameAlong(G.pointOf(shaft, (CX0 + CX1) / 2, 0, 0), G.radialOf(shaft, drainAt));
  pump.push(solid(G.disc(RC - 2, RC + 2.5, 4.4, drain, P, { bevel: 0.3 }), { tone: "mid" }));
  pump.push(solid(G.prismOf(drain, [[-2.4, -2.4], [2.4, -2.4], [2.4, 2.4], [-2.4, 2.4]], RC + 2.5, RC + 5, P), { tone: "mid" }));
  // Discharge: a neck rising off the casing's round top, a flange pair, the riser and its elbow.
  const dUp = up(DX, 0);
  const neck = G.frameOf([DX, 0, ZS], UP, Y, X);
  pump.push(solid(G.saddleOf(neck, 13, RC, RC + 14, P), { tone: "hi", ...red("discharge") }));
  pump.push(flange(ZS + RC + 14, ZS + RC + 18, 20, dUp, null));
  pump.push(flange(ZS + RC + 18, ZS + RC + 22, 20, dUp, ZS + RC + 22));
  pump.push(solid(G.disc(ZS + RC + 22, ZTOP, 11, dUp, P), { tone: "hi", ...red("discharge") }));
  pump.push(solid(G.disc(ZTOP - 30, ZTOP - 25, 12.4, dUp, P, { bevel: 0.4 }), { tone: "mid" }));
  pump.push(solid(G.sphereOf([DX, 0, ZTOP], 11.6, P), { tone: "hi" }));
  // Suction: a neck out of the casing's eye, a flange pair and the run in.
  pump.push(solid(G.disc(CX0 - 14, CX0, 15, shaft, P), { tone: "hi", ...red("suction") }));
  pump.push(flange(CX0 - 18, CX0 - 14, 22, shaft, null));
  pump.push(flange(CX0 - 22, CX0 - 18, 22, shaft, CX0 - 22));
  pump.push(solid(G.disc(-216, CX0 - 22, 13, shaft, P), { tone: "hi", ...red("suction") }));
  pump.push(flange(-221, -216, 22, shaft, -221));

  /** Screen offset for a part moving `dy` across the shaft and `dz` up, world units. */
  function shift(dy: number, dz: number): [number, number] {
    const a = k.iso([0, dy, dz], P);
    const o = k.iso([0, 0, 0], P);
    return [a[0] - o[0], a[1] - o[1]];
  }

  return {
    P,
    label:
      "An end-suction pump driven by a finned motor: the pump stands on a sole plate on two bolted feet, the suction pipe enters the casing along the shaft through a flange pair, the discharge rises from the casing's top and turns away, a lantern bracket with open windows carries the pump's bearing, a bare jaw coupling joins the shafts, and the motor's feet are bolted to a base frame anchored to the floor. The motor carries a terminal box, a lifting eye and a nameplate.",
    floor: floor.join(""),
    base: base.join("") + anchorsBack,
    anchorsFront,
    motorBack: motorBack.join(""),
    motor: motor.join(""),
    motorFront: motorFront.join(""),
    coupling,
    turning,
    pump: pump.join(""),
    pumpFront: pumpFront.join(""),
    shift,
  };
}

function hex(x: number, y: number, r: number): k.Plane[] {
  return Array.from({ length: 6 }, (_, i) => [x + r * Math.cos((i / 6) * Math.PI * 2 + 0.3), y + r * Math.sin((i / 6) * Math.PI * 2 + 0.3)] as k.Plane);
}

/** A hold-down bolt: washer, nut, and the stud's end. */
function bolt(x: number, y: number, z: number, P: k.Projection) {
  return (
    solid(k.cylinder(x, y, 4.4, z, 1, P, 20), { tone: "mid", crease: "none" }) +
    solid(k.extrude(hex(x, y, 3.4), z + 1, 3, P, { bevel: 0.4 }), { tone: "mid" }) +
    solid(k.cylinder(x, y, 1.5, z + 4, 1.2, P, 12), { tone: "mid", crease: "none" })
  );
}
