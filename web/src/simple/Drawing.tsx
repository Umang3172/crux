// A machine as a flat line drawing, for a card on the home page: ink strokes on
// white, side-on, the way a maintenance sheet draws it. The 3D figure is kept
// for the machine's own page.

import type { Kind } from "../lib/plant";

const ink = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const solid = { ...ink, fill: "var(--mn-panel, #fff)" };
const thin = { ...ink, strokeWidth: 1 };

/** A motor seen side-on: body with cooling fins, fan cover, terminal box and feet. */
function Motor({ x, w = 70, y = 40, h = 40 }: { x: number; w?: number; y?: number; h?: number }) {
  const fins = Array.from({ length: 6 }, (_, i) => x + 12 + (i * (w - 22)) / 5);
  return (
    <g>
      <rect x={x - 10} y={y + 6} width={12} height={h - 12} rx={3} {...solid} />
      <rect x={x} y={y} width={w} height={h} rx={5} {...solid} />
      {fins.map((fx) => (
        <line key={fx} x1={fx} y1={y + 6} x2={fx} y2={y + h - 6} {...thin} />
      ))}
      <rect x={x + w * 0.35} y={y - 9} width={w * 0.3} height={9} rx={2} {...solid} />
      <path d={`M${x + 8} ${y + h} v8 M${x + w - 8} ${y + h} v8`} {...ink} />
    </g>
  );
}

function Base({ x0 = 14, x1 = 186, y = 88 }: { x0?: number; x1?: number; y?: number }) {
  return (
    <g>
      <rect x={x0} y={y} width={x1 - x0} height={7} rx={1.5} {...solid} />
      <line x1={x0 - 6} y1={y + 13} x2={x1 + 6} y2={y + 13} {...thin} strokeDasharray="2 4" />
    </g>
  );
}

function Pump() {
  return (
    <g>
      <Base />
      <Motor x={30} />
      <line x1={100} y1={60} x2={126} y2={60} {...ink} />
      <rect x={106} y={53} width={12} height={14} rx={2} {...solid} />
      {/* The volute: a scroll round the impeller, its outlet rising. */}
      <path d="M144 38 v-12 h12 v12" {...solid} />
      <path d="M141 26 h18" {...ink} />
      <circle cx={150} cy={60} r={24} {...solid} />
      <circle cx={150} cy={60} r={9} {...ink} />
      <path d="M150 51 v-15 M141 60 h-15" {...thin} />
      <path d="M140 84 v4 M160 84 v4" {...ink} />
    </g>
  );
}

function Fan() {
  return (
    <g>
      <Base />
      <Motor x={22} w={58} />
      <line x1={80} y1={60} x2={104} y2={60} {...ink} />
      {/* A scroll housing opening upward, the blades seen through the inlet. */}
      <path d="M146 88 a34 34 0 1 1 30 -34 v-26 h-22" {...solid} />
      <circle cx={142} cy={56} r={14} {...ink} />
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i * Math.PI) / 3;
        return <line key={i} x1={142} y1={56} x2={142 + 13 * Math.cos(a)} y2={56 + 13 * Math.sin(a)} {...thin} />;
      })}
    </g>
  );
}

function Drive() {
  return (
    <g>
      <Base x1={150} />
      <Motor x={24} w={56} />
      <line x1={80} y1={60} x2={92} y2={60} {...ink} />
      {/* Gearbox, then the conveyor's drum and a run of belt. */}
      <rect x={92} y={44} width={40} height={44} rx={4} {...solid} />
      <path d="M100 52 h24 M100 80 h24" {...thin} />
      <line x1={132} y1={62} x2={150} y2={62} {...ink} />
      <circle cx={166} cy={62} r={14} {...solid} />
      <circle cx={166} cy={62} r={3} {...ink} />
      <path d="M152 48 L196 44 M180 62 L196 62" {...thin} />
    </g>
  );
}

function MotorOnly() {
  return (
    <g>
      <Base x0={40} x1={160} />
      <Motor x={62} w={80} />
      <line x1={142} y1={60} x2={164} y2={60} {...ink} />
      {/* The sensor on the drive-end housing, and its lead. */}
      <rect x={124} y={26} width={10} height={8} rx={1.5} {...solid} />
      <path d="M134 30 q24 0 30 -14" {...thin} />
    </g>
  );
}

function Bearing() {
  const balls = Array.from({ length: 9 }, (_, i) => (i * 2 * Math.PI) / 9);
  return (
    <g>
      <circle cx={100} cy={55} r={42} {...solid} />
      <circle cx={100} cy={55} r={34} {...thin} />
      <circle cx={100} cy={55} r={20} {...thin} />
      <circle cx={100} cy={55} r={13} {...ink} />
      {balls.map((a) => (
        <circle key={a} cx={100 + 27 * Math.cos(a)} cy={55 + 27 * Math.sin(a)} r={5.5} {...solid} />
      ))}
    </g>
  );
}

export function Drawing({ kind, label }: { kind: Kind; label: string }) {
  return (
    <svg viewBox="0 0 200 110" role="img" aria-label={label}>
      {kind === "pump" ? <Pump /> : kind === "fan" ? <Fan /> : kind === "drive" ? <Drive /> : kind === "motor" ? <MotorOnly /> : <Bearing />}
    </svg>
  );
}
