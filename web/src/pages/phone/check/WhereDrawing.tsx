// A side view of the pump set with the sensor's spot marked. It is drawn, not
// rendered in 3D, so it paints at once on a phone and stays sharp in sunlight.
// Schematic: the proportions are not to scale.

import type { TestId } from "../../../api/types";
import s from "./WhereDrawing.module.css";

export type Spot = "bearing" | "foot";

/** The looseness check moves the sensor to a mounting foot; every other check is taken at the drive end. */
export const spotFor = (test: TestId): Spot => (test === "half_order" ? "foot" : "bearing");

const SPOTS = {
  bearing: { x: 151, y: 86, r: 34, label: "Drive-end bearing", aria: "the drive-end bearing housing, between the motor and the coupling" },
  foot: { x: 112, y: 118, r: 15, label: "Mounting foot", aria: "a mounting foot of the motor" },
} as const;

export function WhereDrawing({ spot }: { spot: Spot }) {
  const at = SPOTS[spot];
  const labelOnTop = spot === "bearing";
  const labelWidth = 128;
  const labelY = labelOnTop ? 4 : 138;
  return (
    <figure className={s.figure}>
      <svg
        viewBox="0 0 360 162"
        role="img"
        aria-label={`Side view of the pump set, not to scale. Put the sensor on ${at.aria}.`}
        className={s.svg}
      >
        {/* The line to the label goes first, so the machine is drawn over it. */}
        {labelOnTop ? (
          <line className={s.leader} x1={at.x} y1={labelY + 22} x2={at.x} y2={at.y - at.r} />
        ) : (
          <line className={s.leader} x1={at.x} y1={at.y + at.r} x2={at.x} y2={labelY} />
        )}

        <rect className={s.base} x="6" y="124" width="348" height="9" />
        {[24, 100, 214, 300].map((x) => (
          <rect key={x} className={spot === "foot" && x === 100 ? s.spot : s.base} x={x} y="114" width="24" height="10" />
        ))}

        <rect className={s.metal} x="6" y="68" width="8" height="32" />
        <rect className={s.body} x="12" y="56" width="124" height="58" />
        <path className={s.fin} d="M24 70h100M24 85h100M24 100h100" />
        <rect className={s.metal} x="62" y="44" width="28" height="12" />

        <rect className={spot === "bearing" ? s.spot : s.metal} x="140" y="64" width="22" height="44" />
        <rect className={s.metal} x="162" y="80" width="28" height="10" />
        <rect className={s.metal} x="190" y="68" width="10" height="34" />
        <rect className={s.metal} x="204" y="68" width="10" height="34" />
        <rect className={s.metal} x="214" y="80" width="6" height="10" />

        <rect className={s.body} x="220" y="72" width="30" height="30" />
        <rect className={s.body} x="250" y="52" width="58" height="58" rx="10" />
        <rect className={s.metal} x="270" y="34" width="18" height="20" />
        <rect className={s.metal} x="308" y="72" width="24" height="22" />

        <circle className={s.ring} cx={at.x} cy={at.y} r={at.r} />

        <text className={s.part} x="6" y="16">
          MOTOR
        </text>
        <text className={s.part} x="354" y="16" textAnchor="end">
          PUMP
        </text>

        <g>
          <rect className={s.flag} x={at.x - labelWidth / 2} y={labelY} width={labelWidth} height="22" />
          <text className={s.flagText} x={at.x} y={labelY + 16}>
            {at.label.toUpperCase()}
          </text>
        </g>
      </svg>
    </figure>
  );
}
