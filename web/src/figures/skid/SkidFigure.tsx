// The motor and pump from the demo clip, running. When the scan measured the
// clip shaking, the motor shakes on its feet; when it found a loose part, that
// anchor nut rattles down its stud. The part the scan points at is drawn
// red. Drag sideways to turn the machine; it settles back when let go.

import { useEffect, useMemo, useRef, useState } from "react";
import { useInView, useReducedMotion } from "../../lib/hooks";
import { follow, useLoop } from "../live";
import { Plate, Raw } from "../Plate";
import { AZ_RANGE, AZ_REST, buildSkid, H, W } from "./geometry";
import { NUT_DROP, PART_NAME, type PartId, SHAKE_HZ_DRAWN, SHAKE_UNITS } from "./model";

const TAU = Math.PI * 2;

export function SkidFigure({
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
  const loose = part === "looseBolt";
  const [az, setAz] = useState(AZ_REST);
  const geo = useMemo(() => buildSkid(az), [az]);
  const reduced = useReducedMotion();
  const [stage, seen] = useInView<HTMLDivElement>();
  const motor = useRef<SVGGElement>(null);
  const nut = useRef<SVGGElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const t = useRef(0);
  const drag = useRef<{ x: number; az: number } | null>(null);
  const target = useRef(AZ_REST);
  const live = useRef(AZ_REST);

  const draw = (dt: number) => {
    t.current += reduced ? 0 : dt;
    const phase = TAU * SHAKE_HZ_DRAWN * t.current;
    const s = Math.sin(phase);
    const [dx, dy] = geo.shift(SHAKE_UNITS * s, 0.5 * SHAKE_UNITS * Math.max(0, Math.sin(phase + 0.6)));
    motor.current?.setAttribute("transform", reduced || !shakes ? "" : `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
    const drop = !loose ? 0 : reduced ? NUT_DROP : NUT_DROP * (0.55 + 0.45 * Math.max(0, Math.sin(phase + 0.9)));
    if (nut.current) nut.current.innerHTML = geo.looseBolt(drop, loose);
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

  const pumpParts = geo.pumpSvg(part);

  return (
    <div ref={stage}>
      <Plate
        fig={fig}
        title={title}
        hint="drag to turn"
        readout={readout}
        keys={[]}
        role="img"
        aria-label={`${geo.label}${part ? ` Drawn in red: ${PART_NAME[part]}.` : ""}`}
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
          <Raw svg={geo.groundBack} />
          <g ref={nut} />
          <Raw svg={geo.groundFront + pumpParts.suction + pumpParts.pump + pumpParts.frame + pumpParts.coupling + geo.tightBack} />
          <g ref={motor}>
            <Raw svg={geo.motorSvg(part)} />
          </g>
          <Raw svg={geo.tightFront} />
        </svg>
      </Plate>
    </div>
  );
}
