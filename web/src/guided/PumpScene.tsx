/**
 * The machine on screen: chilled-water pump 2 in a data hall's cooling loop.
 *
 * A finned motor drives an end-suction pump through a coupling, on a bolted
 * skid, in front of a row of server cabinets. Chilled water leaves the pump up a
 * riser to the cabinets; warm water returns low into the pump's suction. Every
 * fault Crux reasons about has a place here: the impeller (imbalance), the
 * coupling (misalignment), the skid bolts (looseness), the drive-end bearing
 * (race defects).
 *
 * Before the verdict the scene only shakes in proportion to the measured
 * vibration, so it never gives the answer away. After it, the blamed part turns
 * red and is labelled.
 */

import { useEffect, useMemo, useState } from "react";
import { Part } from "./plain";
import { Solid, Vec3, box, cylinder, lit, onCircle, pipe, project, sortSolids, toPoints } from "./iso";

export type SceneStatus = "off" | "running" | "investigating" | "decided" | "healthy";

const SCALE = 22;
const AXIS_Z = 2.35;

const PAINT = {
  floor: "#D9E1E6",
  skid: "#3B4752",
  motor: "#2F6690",
  motorDark: "#285878",
  steel: "#B4C1C9",
  shaft: "#D2DADF",
  bolt: "#8E9CA6",
  cabinet: "#46535E",
  unit: "#56646F",
  insulation: "#E4EAEE",
};

const FAULT = "#D7383B";

const SUPPLY: Vec3[] = [
  [10.35, 2, 3.9],
  [10.35, 2, 6.6],
  [10.35, -6.3, 6.6],
  [1.5, -6.3, 6.6],
  [1.5, -6.3, 5.2],
];
const RETURN: Vec3[] = [
  [11.6, 2, AXIS_Z],
  [16.6, 2, AXIS_Z],
  [16.6, -5.35, AXIS_Z],
];

/** Where each part's label points. */
const ANCHOR: Record<Exclude<Part, "none">, Vec3> = {
  rotor: [10.35, 3.2, 3.6],
  coupling: [8.5, 2.62, 2.9],
  bearing: [7.45, 2.75, 3.0],
  base: [13.6, 4, 0.55],
};

function buildScene(): Solid[] {
  const s: Solid[] = [];

  // Server cabinets along the back wall, each with a column of server faces.
  for (let i = 0; i < 6; i++) {
    const x0 = -1.2 + i * 3;
    s.push(box([x0, -7.2, 0], [x0 + 2.86, -5.4, 5.2], PAINT.cabinet, { layer: 1 }));
  }

  s.push(box([0, 0, 0], [14.6, 4, 0.55], PAINT.skid, { layer: 1, part: "base" }));
  for (const [x, y] of [
    [0.55, 0.55],
    [0.55, 3.45],
    [7.3, 0.55],
    [7.3, 3.45],
    [14.05, 0.55],
    [14.05, 3.45],
  ]) {
    s.push(cylinder("z", [x, y, 0.55], 0.2, 0.2, PAINT.bolt, { part: "base", segments: 12 }));
  }

  // Motor: feet, fan cover, a finned body, terminal box, drive-end shield.
  s.push(box([1.4, 0.75, 0.55], [2.4, 3.25, 1.1], PAINT.motorDark));
  s.push(box([5.3, 0.75, 0.55], [6.3, 3.25, 1.1], PAINT.motorDark));
  s.push(cylinder("x", [0.3, 2, AXIS_Z], 0.85, 1.38, PAINT.motorDark));
  let x = 1.15;
  let fin = true;
  while (x < 6.9) {
    const len = fin ? 0.14 : 0.42;
    s.push(cylinder("x", [x, 2, AXIS_Z], Math.min(len, 6.9 - x), fin ? 1.64 : 1.5, PAINT.motor));
    x += len;
    fin = !fin;
  }
  s.push(box([3.2, 1.35, 3.7], [4.7, 2.65, 4.5], PAINT.motor));
  s.push(cylinder("x", [6.9, 2, AXIS_Z], 0.36, 1.28, PAINT.motor));

  // Drive-end bearing, shaft and coupling.
  s.push(cylinder("x", [7.26, 2, AXIS_Z], 0.46, 0.74, PAINT.steel, { part: "bearing" }));
  s.push(cylinder("x", [7.72, 2, AXIS_Z], 0.4, 0.22, PAINT.shaft, { segments: 16 }));
  s.push(cylinder("x", [8.12, 2, AXIS_Z], 0.8, 0.62, PAINT.steel, { part: "coupling" }));
  s.push(cylinder("x", [8.92, 2, AXIS_Z], 0.5, 0.22, PAINT.shaft, { segments: 16 }));

  // Pump: volute around the impeller, front cover.
  s.push(cylinder("x", [9.42, 2, AXIS_Z], 1.9, 1.78, PAINT.motor, { part: "rotor" }));
  s.push(cylinder("x", [11.32, 2, AXIS_Z], 0.28, 1.15, PAINT.steel, { part: "rotor" }));

  s.push(...pipe(SUPPLY, 0.36, PAINT.insulation));
  s.push(...pipe(RETURN, 0.4, PAINT.insulation));
  return sortSolids(s);
}

/** Bounds of the drawing in screen units, with room for the label. */
const FLOOR: Vec3[] = [
  [-1.9, -7.8, 0],
  [17.6, -7.8, 0],
  [17.6, 5.4, 0],
  [-1.9, 5.4, 0],
];

function viewBox(solids: Solid[]): string {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const all = [...solids.flatMap((solid) => solid.faces.flatMap((f) => f.pts)), ...FLOOR];
  for (const p of all) {
        const [x, y] = project(p);
        x0 = Math.min(x0, x * SCALE);
        y0 = Math.min(y0, y * SCALE);
        x1 = Math.max(x1, x * SCALE);
        y1 = Math.max(y1, y * SCALE);
  }
  const pad = 12;
  return `${x0 - pad} ${y0 - pad - 40} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2 + 40}`;
}

function usePhase(running: boolean): number {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!running) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last > 33) {
        setPhase((p) => (p + 0.22) % (2 * Math.PI));
        last = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);
  return phase;
}

export function PumpScene({
  status,
  vibration,
  highlight,
  highlightLabel,
}: {
  status: SceneStatus;
  /** Measured vibration as a multiple of a healthy pump's; 1 means normal. */
  vibration: number;
  highlight: Part | null;
  highlightLabel?: string;
}) {
  const solids = useMemo(buildScene, []);
  const box = useMemo(() => viewBox(solids), [solids]);
  const running = status !== "off";
  const phase = usePhase(running);
  const amp = running ? Math.min(3, 0.25 + Math.max(0, vibration - 1) * 0.9) : 0;

  const shadow: Vec3[] = [
    [-0.4, -0.3, 0],
    [15.4, -0.3, 0],
    [15.4, 4.9, 0],
    [-0.4, 4.9, 0],
  ];

  // The coupling's bolt heads turn with the shaft: the one sign the pump is running.
  const bolts = Array.from({ length: 6 }, (_, i) => {
    const t = phase + (i / 6) * 2 * Math.PI;
    const c = onCircle("x", [8.93, 2, AXIS_Z], 0.4, t, 0);
    return Array.from({ length: 10 }, (_, j) => onCircle("x", c, 0.075, (j / 10) * 2 * Math.PI, 0));
  });

  const isCabinet = (s: Solid) => s.layer === 1 && s.part !== "base";
  const cabinets = solids.filter(isCabinet);
  const machine = solids.filter((s) => !isCabinet(s));
  const anchor = highlight && highlight !== "none" ? project(ANCHOR[highlight]) : null;
  const labelWidth = (highlightLabel?.length ?? 0) * 7.4 + 28;

  return (
    <svg
      className={`iso${running ? " running" : ""}`}
      viewBox={box}
      role="img"
      aria-label="Chilled-water pump 2: a motor driving a pump through a coupling on a bolted skid, piped to a row of server cabinets"
    >
      <defs>
        <filter id="iso-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>

      <polygon points={toPoints(FLOOR, SCALE)} fill={lit(PAINT.floor, [0, 0, 1])} />
      <polygon points={toPoints(shadow, SCALE)} className="iso-shadow" filter="url(#iso-soft)" />

      {cabinets.map((s, i) => (
          <g key={`cab-${i}`}>
            {s.faces.map((f, j) => (
              <polygon key={j} points={toPoints(f.pts, SCALE)} fill={lit(f.color, f.n)} stroke={lit(f.color, f.n)} strokeWidth={0.6} />
            ))}
          </g>
        ))}
      <Cabinets />

      <g className="iso-machine" style={{ ["--amp" as string]: `${amp}px` }}>
        {machine.map((s, i) => {
            const hot = !!highlight && s.part === highlight;
            return (
              <g key={i} className={hot ? "iso-hot" : undefined}>
                {s.faces.map((f, j) => {
                  const fill = lit(hot ? FAULT : f.color, f.n);
                  return <polygon key={j} points={toPoints(f.pts, SCALE)} fill={fill} stroke={fill} strokeWidth={0.6} />;
                })}
              </g>
            );
          })}
        {bolts.map((pts, i) => (
          <polygon key={i} points={toPoints(pts, SCALE)} fill={lit(PAINT.bolt, [1, 0, 0])} />
        ))}
      </g>

      <polyline className={`iso-flow supply${running ? "" : " still"}`} points={toPoints(SUPPLY, SCALE)} />
      <polyline className={`iso-flow return${running ? "" : " still"}`} points={toPoints([...RETURN].reverse(), SCALE)} />

      {anchor && highlightLabel && (
        <g className="iso-callout">
          <line
            x1={anchor[0] * SCALE}
            y1={anchor[1] * SCALE}
            x2={anchor[0] * SCALE + 40}
            y2={anchor[1] * SCALE - 92}
          />
          <circle cx={anchor[0] * SCALE} cy={anchor[1] * SCALE} r={4} />
          <rect
            x={anchor[0] * SCALE + 40 - labelWidth / 2}
            y={anchor[1] * SCALE - 92 - 30}
            width={labelWidth}
            height={30}
            rx={15}
          />
          <text x={anchor[0] * SCALE + 40} y={anchor[1] * SCALE - 92 - 10} textAnchor="middle">
            {highlightLabel}
          </text>
        </g>
      )}
    </svg>
  );
}

/** Server faces and status lights on the cabinets' front panels. */
function Cabinets() {
  const units: { pts: Vec3[]; led: Vec3[][] }[] = [];
  for (let i = 0; i < 6; i++) {
    const x0 = -1.2 + i * 3;
    for (let k = 0; k < 7; k++) {
      const z0 = 0.45 + k * 0.64;
      const y = -5.39;
      units.push({
        pts: [
          [x0 + 0.22, y, z0],
          [x0 + 2.64, y, z0],
          [x0 + 2.64, y, z0 + 0.5],
          [x0 + 0.22, y, z0 + 0.5],
        ],
        led: [0.45, 0.72].map((dx) => [
          [x0 + dx, y + 0.001, z0 + 0.19],
          [x0 + dx + 0.13, y + 0.001, z0 + 0.19],
          [x0 + dx + 0.13, y + 0.001, z0 + 0.31],
          [x0 + dx, y + 0.001, z0 + 0.31],
        ]),
      });
    }
  }
  return (
    <g>
      {units.map((u, i) => (
        <g key={i}>
          <polygon points={toPoints(u.pts, SCALE)} fill={lit(PAINT.unit, [0, 1, 0])} />
          {u.led.map((l, j) => (
            <polygon
              key={j}
              points={toPoints(l, SCALE)}
              className="iso-led"
              style={{ animationDelay: `${((i * 7 + j * 3) % 11) * 0.23}s` }}
            />
          ))}
        </g>
      ))}
    </g>
  );
}
