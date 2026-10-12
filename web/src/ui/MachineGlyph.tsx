// A machine at a glance, for a tile on the plant floor. A modelled machine's
// rotor turns, and how fast it turns against the others is true: the speeds
// are in proportion to their rpm, all slowed alike. A machine nobody measures
// stands still, because nothing is known about how it runs.

import type { Kind } from "../lib/plant";
import { cx, type Tone } from "./kit";

/** Seconds on screen for one turn at 1,800 rpm; faster machines turn in less. */
const TURN_AT_1800 = 3.2;

export function MachineGlyph({ kind, rpm, running, tone = "neutral" }: { kind: Kind; rpm?: number; running?: boolean; tone?: Tone }) {
  const turning = !!running && !!rpm;
  const spin = turning ? { animationDuration: `${(TURN_AT_1800 * 1800) / (rpm ?? 1800)}s` } : undefined;
  const rotor = cx("glyph-rotor", turning && "spin");
  return (
    <svg className={cx("glyph", tone !== "neutral" && `tone-${tone}`)} viewBox="0 0 96 56" width={96} height={56} aria-hidden>
      <rect x={6} y={46} width={84} height={4} rx={1} className="glyph-base" />
      {kind === "bearing" ? (
        <g transform="translate(48 26)">
          <circle r={20} className="glyph-body" />
          <circle r={9} className="glyph-hole" />
          {Array.from({ length: 9 }, (_, i) => {
            const a = (i / 9) * Math.PI * 2;
            return <circle key={i} cx={14.5 * Math.cos(a)} cy={14.5 * Math.sin(a)} r={3} className="glyph-ball" />;
          })}
        </g>
      ) : (
        <>
          <rect x={8} y={18} width={34} height={28} rx={4} className="glyph-body" />
          {[24, 30, 36, 42].map((y) => (
            <line key={y} x1={13} x2={37} y1={y - 2} y2={y - 2} className="glyph-fin" />
          ))}
          <rect x={42} y={29} width={12} height={5} className="glyph-shaft" />
          {kind === "drive" ? (
            <>
              <rect x={54} y={16} width={32} height={30} rx={3} className="glyph-body" />
              <circle cx={64} cy={31} r={6} className="glyph-hole" />
              <circle cx={77} cy={31} r={8} className="glyph-hole" />
            </>
          ) : kind === "motor" ? (
            <>
              <rect x={54} y={27} width={14} height={9} rx={2} className="glyph-body" />
              <path d="M74 22 q6 9 0 18 M80 17 q10 14 0 28" className="glyph-wave" />
            </>
          ) : (
            <>
              {kind === "fan" ? <path d="M70 12 H90 V26" className="glyph-body" /> : <path d="M78 14 V4 H90 V20" className="glyph-body" />}
              <circle cx={70} cy={31} r={16} className="glyph-body" />
              <g transform="translate(70 31)">
                <g className={rotor} style={spin}>
                  {[0, 120, 240].map((a) => (
                    <path key={a} d={kind === "fan" ? "M3 0 L12 -3" : "M3 0 Q9 -7 12 -1"} transform={`rotate(${a})`} className="glyph-blade" />
                  ))}
                  <circle r={2.6} className="glyph-hub" />
                </g>
              </g>
            </>
          )}
        </>
      )}
    </svg>
  );
}
