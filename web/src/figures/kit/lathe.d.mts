// Types for the parts of lathe.mjs the figures call. The module itself is the
// kit's plain JavaScript, kept as shipped apart from its import path.

import type { Flat, Point3, Projection, SolidPaths } from "./iso-kit";

export type Frame = { o: Point3; a: Point3; u: Point3; v: Point3 };
/** A meridian point: [s along the axis, r from it], with a third value 1 for a smooth knot. */
export type Knot = [number, number] | [number, number, number];
export type Faded = { d: string; alpha: number };

export function dot3(a: Point3, b: Point3): number;
export function add3(a: Point3, b: Point3): Point3;
export function sub3(a: Point3, b: Point3): Point3;
export function mul3(a: Point3, k: number): Point3;
export function unit3(a: Point3): Point3;
export function cross3(a: Point3, b: Point3): Point3;
export function viewOf(P: Projection): Point3;
export function scaleOf(P: Projection): number;
export function frameAlong(o: Point3, a: Point3): Frame;
export function frameOf(o: Point3, a: Point3, u: Point3, v: Point3): Frame;
export function pointOf(F: Frame, s: number, r: number, angle: number): Point3;
export function radialOf(F: Frame, angle: number): Point3;
export function facingOf(F: Frame, angle: number, P: Projection, slope?: number): number;
export function fadeOf(value: number, range: [number, number]): number;

type LatheOptions = {
  steps?: number;
  fill?: "auto" | "hull" | "surface" | "facets";
  hole?: [number, number] | null;
  bevel?: number;
  rims?: "all" | "none" | "first" | "last" | "ends";
  smooth?: boolean | "auto" | { rows?: number; slope?: (s: number) => number; radius?: (s: number) => number };
  waist?: number;
};
export function lathe(meridian: Knot[], F: Frame, P: Projection, options?: LatheOptions): SolidPaths;
export function solidOf(profile: Knot[], F: Frame, P: Projection, options?: LatheOptions): SolidPaths;
export function disc(s0: number, s1: number, r: number, F: Frame, P: Projection, options?: LatheOptions): SolidPaths;
export function ringBand(s0: number, s1: number, rIn: number, rOut: number, F: Frame, P: Projection, options?: LatheOptions): SolidPaths;
export function prismOf(F: Frame, polygon: [number, number][], s0: number, s1: number, P: Projection): SolidPaths;
export function sphereOf(centre: Point3, r: number, P: Projection, options?: { steps?: number }): SolidPaths;

export function arcOf(
  F: Frame,
  s: number,
  r: number,
  P: Projection,
  options?: { slope?: number; steps?: number; least?: number; inward?: boolean; from?: number; to?: number; trim?: number },
): string;
export function circleOf(F: Frame, s: number, r: number, P: Projection, steps?: number): string;
export function spokesOf(F: Frame, s: number, r0: number, r1: number, count: number, P: Projection, options?: { phase?: number; sweep?: number; from?: number; to?: number }): string;
export function ribsOf(
  F: Frame,
  s0: number,
  s1: number,
  r: number,
  count: number,
  P: Projection,
  options?: { phase?: number; twist?: number; least?: number; r1?: number; fade?: [number, number] | null; seams?: boolean | "first" | "last" },
): string | Faded[];
export function dotsOf(
  F: Frame,
  s: number,
  r: number,
  count: number,
  P: Projection,
  options?: { phase?: number; slope?: number; least?: number; all?: boolean; fade?: [number, number] | null },
): Array<Flat | [number, number, number]>;
export function fillet(points: Point3[], radius: number, perArc?: number, options?: { P?: Projection | null; tube?: number; margin?: number }): Point3[];
