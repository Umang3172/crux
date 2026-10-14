// Fig 1, live: the bearing turns at the speed you set, slowed so the eye can
// follow, and each time a ball reaches the pit the pit flashes and the dial
// kicks. The readout gives the true rate at that speed. Speed and the rates come
// from the engine's machine model; the figure only slows the clock.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MachineModel } from "../../api/types";
import { useInView, useReducedMotion } from "../../lib/hooks";
import { Button, Seg } from "../../ui/kit";
import { burst, follow, useLoop } from "../live";
import { Plate, Raw } from "../Plate";
import { buildBearing, H, W } from "./geometry";
import { DAMAGE, PERIOD_S, RPM_MAX, RPM_MIN, fmt, perSecond, poseAt, ratesOf, type Damage } from "./model";

const STEP = 100;

export function BearingFigure({ model }: { model: MachineModel }) {
  const geo = useMemo(() => buildBearing(model), [model]);
  const rates = useMemo(() => ratesOf(model), [model]);
  const nominal = model.nominal_rpm;
  const [damage, setDamage] = useState<Damage>("outer");
  const [rpm, setRpm] = useState(nominal);
  const reduced = useReducedMotion();
  const [stage, seen] = useInView<HTMLDivElement>();
  const clip = useId().replace(/:/g, "");

  const far = useRef<SVGGElement>(null);
  const nearBalls = useRef<SVGGElement>(null);
  const spin = useRef<SVGGElement>(null);
  const pitIn = useRef<SVGGElement>(null);
  const flash = useRef<SVGGElement>(null);
  const needle = useRef<SVGPathElement>(null);
  const knob = useRef<SVGPathElement>(null);
  const readout = useRef<HTMLSpanElement>(null);

  const s = useRef({ turns: 0, rpm: nominal, target: nominal, passes: NaN, knockAt: -9, clock: 0, damage: "outer" as Damage, pit: "" });
  s.current.target = rpm;
  s.current.damage = damage;

  const draw = (dt: number) => {
    const st = s.current;
    st.clock += dt;
    st.rpm = follow(st.rpm, st.target, dt, 0.35, reduced);
    if (!reduced) st.turns += (dt / PERIOD_S) * (st.rpm / nominal);
    const pose = poseAt(rates, st.damage, st.turns);
    if (st.damage !== "none" && pose.passes !== st.passes && !Number.isNaN(st.passes) && !reduced) st.knockAt = st.clock;
    st.passes = pose.passes;
    const b = geo.balls(pose.cage);
    if (far.current) far.current.innerHTML = b.far;
    if (nearBalls.current) nearBalls.current.innerHTML = b.near;
    if (spin.current) spin.current.innerHTML = geo.spindle(pose.shaft);
    const pit = st.damage === "inner" ? geo.innerPit(pose.shaft) : "";
    if (pitIn.current) pitIn.current.innerHTML = pit;
    const level = st.damage === "none" ? 0 : burst(st.clock - st.knockAt, 0.05, 0.22);
    if (flash.current) {
      flash.current.style.opacity = level.toFixed(3);
      const want = st.damage === "outer" ? geo.pitOuter : pit;
      if (want !== st.pit) {
        flash.current.innerHTML = want;
        st.pit = want;
      }
    }
    needle.current?.setAttribute("d", geo.needle(0.06 + 0.8 * level));
    knob.current?.setAttribute("d", geo.knobPointer((st.rpm - RPM_MIN) / (RPM_MAX - RPM_MIN)));
    if (readout.current) {
      const hz = perSecond(rates, st.damage, st.rpm);
      const what = DAMAGE.find((d) => d.id === st.damage)!.label.toLowerCase();
      readout.current.textContent = st.damage === "none" ? `${fmt(st.rpm, 0)} rpm · no knock` : `${what} · ${fmt(st.rpm, 0)} rpm · ${fmt(hz)} knocks/s`;
    }
    return !reduced || Math.abs(st.rpm - st.target) > 0.5 || level > 0.002;
  };

  const kick = useLoop(draw, seen);
  useEffect(() => {
    draw(0);
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, damage, rpm, reduced]);

  const setSpeed = (v: number) => setRpm(Math.round(Math.max(RPM_MIN, Math.min(RPM_MAX, v)) / 10) * 10);
  const drag = useRef<{ x: number; rpm: number } | null>(null);
  const valueText = `${fmt(rpm, 0)} rpm. ${damage === "none" ? "No damage: nothing knocks." : `${DAMAGE.find((d) => d.id === damage)!.label} pit: ${fmt(perSecond(rates, damage, rpm))} knocks a second.`}`;

  return (
    <div className="col gap-3" ref={stage}>
      <div className="row row-wrap gap-3">
        <Seg value={damage} onChange={setDamage} options={DAMAGE} label="Where the damage is" />
        <Button size="sm" variant="ghost" onClick={() => setSpeed(nominal)} disabled={rpm === nominal}>
          Normal speed
        </Button>
      </div>
      <Plate
        fig="Fig 1"
        title="One pit, one rate"
        hint="Drag or ← → for speed"
        readout={readout}
        keys={[
          { mark: "pit", label: "the pit, flashing as a ball strikes it" },
          { mark: "pick", label: "the pickup that hears it" },
          { mark: "lit", label: "one ball and the shaft's index mark, to compare their turns" },
        ]}
        caption={
          <>
            The engine's {model.bearing.label.split(" (")[0]} bearing on a test spindle, the top halves of both rings cut away. Its {rates.balls} balls ride a{" "}
            {model.bearing.pitch_diameter_mm} mm circle, so the cage turns {fmt(rates.cage, 3)} times per turn of the shaft: a ball passes a point on the outer
            ring {fmt(rates.outer, 3)} times a turn and a point on the inner ring {fmt(rates.inner, 3)} times. At {fmt(nominal, 0)} rpm that is{" "}
            {fmt(perSecond(rates, "outer", nominal))} and {fmt(perSecond(rates, "inner", nominal))} knocks a second, the two rates the engine listens for.
            Every rate is read from the engine; only the clock is slowed, about {Math.round((PERIOD_S * nominal) / 60)} times.
          </>
        }
        role="slider"
        tabIndex={0}
        aria-label="Bearing speed. Left and right arrows change it; Shift for bigger steps."
        aria-valuemin={RPM_MIN}
        aria-valuemax={RPM_MAX}
        aria-valuenow={rpm}
        aria-valuetext={valueText}
        onKeyDown={(e) => {
          const big = e.shiftKey ? 5 : 1;
          if (e.key === "ArrowRight" || e.key === "ArrowUp") setSpeed(rpm + STEP * big);
          else if (e.key === "ArrowLeft" || e.key === "ArrowDown") setSpeed(rpm - STEP * big);
          else if (e.key === "Home") setSpeed(RPM_MIN);
          else if (e.key === "End") setSpeed(RPM_MAX);
          else return;
          e.preventDefault();
        }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, rpm };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const width = (e.currentTarget as HTMLElement).clientWidth || 600;
          setSpeed(drag.current.rpm + ((e.clientX - drag.current.x) / width) * (RPM_MAX - RPM_MIN));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <svg className="iso-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={geo.label}>
          <defs>
            <clipPath id={clip}>
              <path d={geo.outerClip} />
            </clipPath>
          </defs>
          <Raw svg={geo.back} />
          <Raw svg={geo.outer} />
          <g style={{ display: damage === "outer" ? undefined : "none" }}>
            <Raw svg={geo.pitOuter} />
          </g>
          <g ref={far} />
          <Raw svg={geo.inner} />
          <g ref={pitIn} />
          <g ref={spin} />
          <g ref={nearBalls} />
          <g clipPath={`url(#${clip})`}>
            <Raw svg={geo.outerNear} />
          </g>
          <g ref={flash} className="fx-flash" style={{ opacity: 0 }} />
          <Raw svg={geo.front} />
          <path ref={needle} className="iso-line" data-tone="lit" data-free="start" style={{ strokeWidth: 1.1 }} />
          <path ref={knob} className="iso-line" data-tone="hi" />
        </svg>
      </Plate>
    </div>
  );
}
