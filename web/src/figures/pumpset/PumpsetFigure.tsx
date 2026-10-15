// The pump set from the clean demo clip, running: its coupling turns, drawn
// slow. The part a scan points at is drawn red, and when the scan measured that
// part shaking, the motor or the pump shakes on its feet. With nothing found,
// nothing is red. Drag sideways to turn the machine; it settles back when let go.

import { useEffect, useMemo, useRef, useState } from "react";
import { useInView, useReducedMotion } from "../../lib/hooks";
import { follow, useLoop } from "../live";
import { Plate, Raw } from "../Plate";
import { AZ_RANGE, AZ_REST, buildPumpset, H, W } from "./geometry";
import { PART_NAME, type PartId, SHAKE_HZ_DRAWN, SHAKE_UNITS, TURN_HZ_DRAWN } from "./model";

const TAU = Math.PI * 2;
const ON_PUMP: ReadonlySet<PartId> = new Set(["bracket", "casing", "suction", "discharge"]);

export function PumpsetFigure({
  part,
  shakes,
  readout: said,
  fig = "Fig 1",
  title = "The machine, drawn from the clip",
}: {
  part: PartId | null;
  shakes: boolean;
  readout: string;
  fig?: string;
  title?: string;
}) {
  const [az, setAz] = useState(AZ_REST);
  const geo = useMemo(() => buildPumpset(az, part), [az, part]);
  const reduced = useReducedMotion();
  const [stage, seen] = useInView<HTMLDivElement>();
  const motor = useRef<SVGGElement>(null);
  const pump = useRef<SVGGElement>(null);
  const motorScrew = useRef<SVGGElement>(null);
  const jaws = useRef<SVGGElement>(null);
  const pumpScrew = useRef<SVGGElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const t = useRef(0);
  const drag = useRef<{ x: number; az: number } | null>(null);
  const target = useRef(AZ_REST);
  const live = useRef(AZ_REST);
  const shaking = shakes ? (part && ON_PUMP.has(part) ? pump : motor) : null;

  const draw = (dt: number) => {
    t.current += reduced ? 0 : dt;
    const turn = geo.turning(0.6 + TAU * TURN_HZ_DRAWN * t.current);
    if (motorScrew.current) motorScrew.current.innerHTML = turn.motorScrew;
    if (jaws.current) jaws.current.innerHTML = turn.jaws;
    if (pumpScrew.current) pumpScrew.current.innerHTML = turn.pumpScrew;
    const phase = TAU * SHAKE_HZ_DRAWN * t.current;
    const [dx, dy] = geo.shift(SHAKE_UNITS * Math.sin(phase), 0.5 * SHAKE_UNITS * Math.max(0, Math.sin(phase + 0.6)));
    for (const g of [motor, pump]) g.current?.setAttribute("transform", reduced || g !== shaking ? "" : `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
    // Let go of a drag and the camera eases back to rest.
    if (!drag.current && Math.abs(live.current - target.current) > 0.05) {
      live.current = follow(live.current, target.current, dt, 0.35, reduced);
      setAz(Math.round(live.current));
    }
    return !reduced;
  };
  const kick = useLoop(draw, seen);
  useEffect(() => {
    draw(0);
    kick();
    if (readout.current) readout.current.textContent = said;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, part, shakes, said, reduced]);

  const c = geo.coupling;

  return (
    <div ref={stage}>
      <Plate
        fig={fig}
        title={title}
        hint="drag to turn"
        readout={readout}
        keys={[]}
        role="img"
        aria-label={`${geo.label}${part ? ` Drawn in red: ${PART_NAME[part]}.` : " Nothing is drawn red: the scan found nothing on it."}`}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, az: live.current };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const next = Math.max(AZ_RANGE[0], Math.min(AZ_RANGE[1], drag.current.az - (e.clientX - drag.current.x) / 6));
          live.current = next;
          setAz(Math.round(next));
        }}
        onPointerUp={() => {
          drag.current = null;
          target.current = AZ_REST;
          kick();
        }}
        style={{ cursor: "grab" }}
      >
        <svg className="iso-svg" viewBox={`0 0 ${W} ${H}`} aria-hidden>
          <Raw svg={geo.floor + geo.base + geo.anchorsFront} />
          <g ref={motor}>
            <Raw svg={geo.motorBack + geo.motor + geo.motorFront} />
          </g>
          <Raw svg={c.motorStub + c.motorHub} />
          <g ref={motorScrew} />
          <Raw svg={c.spider} />
          <g ref={jaws} />
          <Raw svg={c.pumpHub} />
          <g ref={pumpScrew} />
          <g ref={pump}>
            <Raw svg={geo.pump + geo.pumpFront} />
          </g>
        </svg>
      </Plate>
    </div>
  );
}
