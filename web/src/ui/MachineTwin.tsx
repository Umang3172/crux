// The pump set, running. Every moving part turns at its real ratio to the
// shaft, taken from the server's own numbers (`GET /machine`): the cage, the
// balls, the impeller, the belt-driven pump. Only the clock is slowed. A flash
// where a ball meets a damaged spot is not drawn in: it falls out of the
// geometry, at the rate the engine listens for.
//
// The machine stays grey. Colour appears only on a part a verdict has named
// and on the point where a measurement is asked for.

import { Pause, Play } from "lucide-react";
import { useState } from "react";
import type { MachineModel } from "../api/types";
import { num } from "../lib/format";
import { useClock, useInView, useReducedMotion } from "../lib/hooks";
import type { Part } from "../lib/plain";
import { Button, cx } from "./kit";

/** Seconds on screen for one turn of the shaft. */
const PERIOD = 4;
const CY = 168;

const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
/** 1 when two angles coincide, falling to 0 at `width` degrees apart. */
const near = (a: number, width: number) => Math.max(0, 1 - Math.abs(wrap(a)) / width);
const polar = (r: number, degrees: number) => {
  const a = (degrees * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a)] as const;
};

/** Marks on a part seen from the side: they cross it as it turns, and fade as they go round the back. */
function Ticks({ x, width, r, turns, n = 4 }: { x: number; width: number; r: number; turns: number; n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, j) => {
        const a = 2 * Math.PI * (turns + j / n);
        const facing = Math.cos(a);
        if (facing <= 0.05) return null;
        const y = CY + r * Math.sin(a);
        return <line key={j} x1={x} x2={x + width} y1={y} y2={y} className="twin-tick" opacity={facing} />;
      })}
    </>
  );
}

export type TwinFrequencies = { shaft?: number; bpfo?: number; bpfi?: number };

export function MachineTwin({
  model,
  rpm,
  part = "none",
  sensor = "idle",
  hz,
  compact,
}: {
  model: MachineModel;
  rpm: number;
  /** The part a verdict has named. Nothing is coloured without one. */
  part?: Part;
  sensor?: "idle" | "asked";
  /** Frequencies the case's own ledger holds, in hertz. */
  hz?: TwinFrequencies;
  compact?: boolean;
}) {
  const reduced = useReducedMotion();
  const [ref, seen] = useInView<HTMLDivElement>();
  const [paused, setPaused] = useState(false);
  const t = useClock(seen && !paused && !reduced);
  const turns = t / PERIOD;
  const shaft = turns * 360;

  const k = model.per_shaft_turn;
  const balls = model.bearing.rolling_elements;
  const cage = shaft * k.ftf;
  const spin = -shaft * k.bsf;

  // The bearing cut open, to scale: the rings sit where the balls' size puts them.
  const BX = 664;
  const BY = 160;
  const pitch = 50;
  const ball = pitch * (model.bearing.ball_diameter_mm / model.bearing.pitch_diameter_mm);
  const innerRace = pitch - ball;
  const outerRace = pitch + ball;

  const innerHit = part === "bearing-inner" ? Math.max(...Array.from({ length: balls }, (_, i) => near(shaft - (cage + (i * 360) / balls), 7))) : 0;
  const outerHit = part === "bearing-outer" ? Math.max(...Array.from({ length: balls }, (_, i) => near(90 - (cage + (i * 360) / balls), 7))) : 0;
  const ballOut = part === "bearing-ball" ? near(spin, 16) : 0;
  const ballIn = part === "bearing-ball" ? near(spin - 180, 16) : 0;
  const aux = shaft * model.auxiliary_pump.belt_ratio;
  const auxHit = part === "aux" ? near(aux * model.auxiliary_pump.lobes, 40) : 0;
  // Out of balance wobbles once a turn; a coupling out of line flexes twice a turn.
  const orderHit = part === "impeller" ? near(shaft, 30) : part === "coupling" ? near(shaft * 2, 50) : 0;
  const hit = Math.max(innerHit, outerHit, ballOut, ballIn, auxHit, orderHit);
  const bearingNamed = part === "bearing-inner" || part === "bearing-outer" || part === "bearing-ball" || part === "bearing";

  const slowed = (rpm / 60) * PERIOD;
  const [ix, iy] = polar(innerRace, shaft);
  const [bx, by] = polar(pitch, cage);

  return (
    <div ref={ref} className="twin">
      <svg viewBox="0 0 760 300" role="img" aria-label="The pump set, with its parts turning at their real ratios to the shaft">
        {/* base and feet */}
        <rect x={40} y={238} width={560} height={10} rx={2} className="twin-base" />
        {[86, 214, 352, 474].map((x) => (
          <rect key={x} x={x} y={224} width={34} height={14} rx={2} className={cx("twin-part", part === "feet" && "named")} />
        ))}

        {/* motor */}
        <rect x={52} y={124} width={24} height={88} rx={6} className="twin-part" />
        <rect x={70} y={112} width={180} height={112} rx={10} className="twin-part" />
        {Array.from({ length: 8 }, (_, i) => (
          <line key={i} x1={92} x2={228} y1={126 + i * 12} y2={126 + i * 12} className="twin-fin" />
        ))}
        <rect x={138} y={96} width={44} height={18} rx={3} className="twin-part" />
        <text x={160} y={272} className="twin-label">
          Motor
        </text>

        {/* shaft */}
        <rect x={250} y={CY - 6} width={196} height={12} className="twin-shaft" />
        <Ticks x={254} width={20} r={6} turns={turns} />
        <Ticks x={326} width={16} r={6} turns={turns} />
        <Ticks x={418} width={22} r={6} turns={turns} />

        {/* coupling */}
        <rect x={278} y={146} width={20} height={44} rx={3} className={cx("twin-part", part === "coupling" && "named")} />
        <rect x={302} y={146} width={20} height={44} rx={3} className={cx("twin-part", part === "coupling" && "named")} />
        <rect x={298} y={152} width={4} height={32} className="twin-flex" />
        <Ticks x={280} width={16} r={20} turns={turns} n={6} />
        <Ticks x={304} width={16} r={20} turns={turns} n={6} />
        <text x={300} y={272} className="twin-label">
          Coupling
        </text>

        {/* drive-end bearing housing */}
        <path d="M356 196 L350 224 H410 L404 196Z" className="twin-part" />
        <rect x={346} y={140} width={68} height={56} rx={6} className={cx("twin-part", bearingNamed && "named")} />
        <circle cx={380} cy={CY} r={18} className="twin-inner" />
        <circle cx={380} cy={CY} r={8} className="twin-shaft" />
        {bearingNamed && hit > 0 && <circle cx={380} cy={CY} r={18 + hit * 12} className="twin-pulse" opacity={hit * 0.9} />}
        <text x={380} y={272} className="twin-label">
          Drive-end bearing
        </text>

        {/* the measurement point */}
        <rect x={392} y={131} width={14} height={9} rx={2} className={cx("twin-sensor", sensor === "asked" && "asked")} />
        <path d="M399 131 C399 112 420 118 432 104" className={cx("twin-wire", sensor === "asked" && "asked")} />
        {sensor === "asked" && (
          <circle cx={399} cy={135} r={10} className="twin-ask">
            {!reduced && <animate attributeName="r" values="8;20;8" dur="1.8s" repeatCount="indefinite" />}
            {!reduced && <animate attributeName="opacity" values="0.9;0;0.9" dur="1.8s" repeatCount="indefinite" />}
          </circle>
        )}
        <text x={436} y={100} className={cx("twin-note", sensor === "asked" && "asked")} textAnchor="start">
          {sensor === "asked" ? "measurement asked for here" : "sensor"}
        </text>

        {/* seal-flush pump, belt-driven from the shaft */}
        <line x1={329} y1={164} x2={318} y2={106} className="twin-belt" />
        <line x1={339} y1={164} x2={338} y2={104} className="twin-belt" />
        <circle cx={334} cy={CY} r={6} className="twin-inner" />
        <circle cx={328} cy={98} r={14} className={cx("twin-part", part === "aux" && "named")} />
        <g transform={`translate(328 98) rotate(${aux % 360})`}>
          {Array.from({ length: model.auxiliary_pump.lobes }, (_, i) => {
            const [x, y] = polar(6.5, (i * 360) / model.auxiliary_pump.lobes);
            return <circle key={i} cx={x} cy={y} r={3.6} className="twin-rotor" />;
          })}
        </g>
        {part === "aux" && auxHit > 0 && <circle cx={328} cy={98} r={14 + auxHit * 10} className="twin-pulse" opacity={auxHit * 0.9} />}
        <text x={306} y={78} className="twin-note" textAnchor="middle">
          seal-flush pump
        </text>

        {/* pump: casing seen from the front, impeller inside */}
        <rect x={440} y={148} width={14} height={40} rx={2} className="twin-part" />
        <path d="M534 100 V72 H580 V124" className="twin-part" />
        <rect x={528} y={64} width={58} height={10} rx={2} className="twin-part" />
        <circle cx={512} cy={CY} r={62} className={cx("twin-part", part === "impeller" && "named")} />
        <circle cx={512} cy={CY} r={52} className="twin-inner" />
        <g transform={`translate(512 ${CY}) rotate(${shaft % 360})`}>
          {Array.from({ length: Math.max(1, model.blade_count) }, (_, i) => (
            <path key={i} d="M9 0 Q28 -22 46 -6" transform={`rotate(${(i * 360) / Math.max(1, model.blade_count)})`} className={cx("twin-blade", part === "impeller" && "named")} />
          ))}
          <circle r={9} className="twin-shaft" />
          {part === "impeller" && <circle cx={36} cy={-10} r={4} className="twin-defect" />}
        </g>
        {part === "impeller" && orderHit > 0 && <circle cx={512} cy={CY} r={62 + orderHit * 8} className="twin-pulse" opacity={orderHit * 0.8} />}
        {part === "coupling" && orderHit > 0 && <rect x={274} y={142} width={52} height={52} rx={6} className="twin-pulse" opacity={orderHit * 0.8} />}
        <text x={512} y={272} className="twin-label">
          Pump · {model.blade_count} blades
        </text>

        {/* the bearing, cut open */}
        <path d={`M414 152 L${BX - outerRace - 12} ${BY - 40} M414 184 L${BX - outerRace - 12} ${BY + 40}`} className="twin-zoom" />
        <g transform={`translate(${BX} ${BY})`}>
          <circle r={outerRace + 9} className={cx("twin-ring", part === "bearing-outer" && "named")} />
          <circle r={outerRace} className="twin-race" />
          {part === "bearing-outer" && <circle cx={0} cy={outerRace} r={3.4} className="twin-defect" />}
          <g transform={`rotate(${shaft % 360})`}>
            <circle r={innerRace} className={cx("twin-ring", part === "bearing-inner" && "named")} />
            <circle r={innerRace - 12} className="twin-bore" />
            <line x1={innerRace - 11} x2={innerRace - 2} className="twin-mark" />
            {part === "bearing-inner" && <circle cx={innerRace} cy={0} r={3.4} className="twin-defect" />}
          </g>
          <g transform={`rotate(${cage % 360})`}>
            <circle r={pitch} className="twin-cage" />
            {Array.from({ length: balls }, (_, i) => (
              <g key={i} transform={`rotate(${(i * 360) / balls}) translate(${pitch} 0)`}>
                <circle r={ball - 0.6} className={cx("twin-ball", part === "bearing-ball" && i === 0 && "named")} />
                <g transform={`rotate(${spin % 360})`}>
                  <line x1={0} x2={ball - 2.2} className="twin-mark" />
                  {part === "bearing-ball" && i === 0 && <circle cx={ball - 1.8} cy={0} r={2.4} className="twin-defect" />}
                </g>
              </g>
            ))}
          </g>
          {innerHit > 0 && <circle cx={ix} cy={iy} r={4 + innerHit * 9} className="twin-flash" opacity={innerHit} />}
          {outerHit > 0 && <circle cx={0} cy={outerRace} r={4 + outerHit * 9} className="twin-flash" opacity={outerHit} />}
          {ballOut > 0 && <circle cx={bx * (outerRace / pitch)} cy={by * (outerRace / pitch)} r={4 + ballOut * 8} className="twin-flash" opacity={ballOut} />}
          {ballIn > 0 && <circle cx={bx * (innerRace / pitch)} cy={by * (innerRace / pitch)} r={4 + ballIn * 8} className="twin-flash" opacity={ballIn} />}
        </g>
        <text x={BX} y={272} className="twin-label">
          The bearing, cut open · {balls} balls
        </text>
      </svg>

      <div className="twin-foot">
        <Button size="sm" variant="ghost" icon={paused || reduced ? <Play size={12} /> : <Pause size={12} />} onClick={() => setPaused((p) => !p)} disabled={reduced} aria-label={paused ? "Run the drawing" : "Pause the drawing"} />
        <span className="twin-fact">
          <b className="num">{num(rpm, 0)}</b> rpm
        </span>
        {!compact && (
          <>
            <span className="twin-fact" data-tip="Turns of the cage that carries the balls, for each turn of the shaft">
              cage <b className="num">{num(k.ftf, 2)}×</b>
            </span>
            <span className="twin-fact" data-tip="Spins of each ball for each turn of the shaft">
              ball spin <b className="num">{num(k.bsf, 2)}×</b>
            </span>
            <span className="twin-fact" data-tip="Balls passing one point on the fixed outer ring, for each turn of the shaft">
              outer-ring pass <b className="num">{num(k.bpfo, 2)}×</b>
              {hz?.bpfo !== undefined && <span className="dim num"> · {num(hz.bpfo, 1)} Hz</span>}
            </span>
            <span className="twin-fact" data-tip="Balls passing one point on the turning inner ring, for each turn of the shaft">
              inner-ring pass <b className="num">{num(k.bpfi, 2)}×</b>
              {hz?.bpfi !== undefined && <span className="dim num"> · {num(hz.bpfi, 1)} Hz</span>}
            </span>
            <span className="twin-fact" data-tip={`Belt ratio ${model.auxiliary_pump.belt_ratio} to 1, ${model.auxiliary_pump.lobes} lobes`}>
              seal-flush pump <b className="num">{num(model.auxiliary_pump.passes_per_shaft_turn, 1)}×</b>
            </span>
          </>
        )}
        <span className="twin-slow">
          {reduced ? "Motion is off in your system settings, so the drawing is still." : `Slowed about ${num(slowed, 0)} times: one turn of the shaft takes ${PERIOD} s here.`}
        </span>
      </div>
    </div>
  );
}
