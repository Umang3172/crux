// The pump set as a flat side view, for browsers that can't draw the 3D
// scene. Same inputs, same rules: a part lights up only when named, and the
// marker shows where a check is taken.

import type { Part } from "../../lib/plain";
import s from "./PumpDrawing.module.css";

const BEARING: Part[] = ["bearing", "bearing-inner", "bearing-outer", "bearing-ball"];

export function PumpDrawing({
  highlight = null,
  marker = null,
  label = "Side view of the pump set: motor, drive-end bearing, coupling and pump",
}: {
  highlight?: Part | null;
  marker?: Part | null;
  label?: string;
}) {
  const hot = (p: Part) => (highlight === p || (p === "bearing" && !!highlight && BEARING.includes(highlight)) ? s.hot : "");
  const markAt = marker === "feet" ? { x: 196, y: 214 } : { x: 300, y: 92 };
  return (
    <svg className={s.drawing} viewBox="0 0 640 260" role="img" aria-label={label}>
      {/* baseplate and feet */}
      <rect x="40" y="226" width="560" height="14" className={`${s.base} ${hot("feet")}`} />
      {[86, 196, 404, 506].map((x) => (
        <rect key={x} x={x} y="206" width="34" height="20" className={`${s.base} ${hot("feet")}`} />
      ))}
      {/* motor with fins and fan cover */}
      <rect x="70" y="96" width="196" height="110" className={s.body} />
      {[118, 138, 158, 178, 198].map((y) => (
        <line key={y} x1="86" x2="250" y1={y} y2={y} className={s.fin} />
      ))}
      <rect x="48" y="108" width="22" height="86" className={s.metal} />
      <rect x="150" y="80" width="44" height="16" className={s.body} />
      {/* drive-end bearing housing */}
      <rect x="266" y="112" width="42" height="78" className={`${s.metal} ${hot("bearing")}`} />
      {/* shaft and coupling */}
      <rect x="308" y="144" width="40" height="14" className={s.metal} />
      <rect x="328" y="124" width="16" height="54" className={`${s.metal} ${hot("coupling")}`} />
      <rect x="346" y="124" width="16" height="54" className={`${s.metal} ${hot("coupling")}`} />
      {/* pump bearing frame, volute, discharge and suction */}
      <rect x="362" y="122" width="62" height="60" className={s.body} />
      <circle cx="492" cy="150" r="70" className={`${s.body} ${hot("impeller")}`} />
      <rect x="474" y="40" width="36" height="44" className={s.metal} />
      <rect x="560" y="132" width="52" height="36" className={s.metal} />
      <rect x="380" y="100" width="28" height="22" className={`${s.body} ${hot("aux")}`} />
      {marker && (
        <g className={s.marker}>
          <circle cx={markAt.x} cy={markAt.y} r="16" />
          <circle cx={markAt.x} cy={markAt.y} r="5" className={s.markerDot} />
        </g>
      )}
    </svg>
  );
}
