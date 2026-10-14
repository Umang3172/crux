// Fig 2, live: the checks the engine can ask a person for, one at a time. The
// pickup is carried to the spot a check's own steps name, the phone's ring fills
// over the capture's true length, and the steps below light in turn. When
// nobody touches it, it walks the whole catalogue.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CatalogTest } from "../../api/types";
import { useInView, useReducedMotion } from "../../lib/hooks";
import { Seg } from "../../ui/kit";
import { follow, useLoop } from "../live";
import { Plate, Raw } from "../Plate";
import { buildRig, H, W } from "./geometry";
import { CARRY_S, SHORT, SHOW_S, minutes, planOf } from "./model";

type P3 = [number, number, number];
/** Seconds on screen for one shaft turn while the motor runs; the clock is slowed, not the machine. */
const TURN_S = 1.4;
const IDLE_S = 10;

const lerp = (a: P3, b: P3, t: number): P3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function SensorFigure({ tests, blades }: { tests: CatalogTest[]; blades: number }) {
  const shown = useMemo(() => tests.filter((t) => planOf(t)), [tests]);
  const geo = useMemo(() => buildRig(blades), [blades]);
  const reduced = useReducedMotion();
  const [stage, seen] = useInView<HTMLDivElement>();
  const [pick, setPick] = useState(0);
  const id = useId();

  const coupling = useRef<SVGGElement>(null);
  const fan = useRef<SVGGElement>(null);
  const tool = useRef<SVGGElement>(null);
  const lead = useRef<SVGGElement>(null);
  const beam = useRef<SVGGElement>(null);
  const ring = useRef<SVGPathElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const steps = useRef<HTMLOListElement>(null);

  const s = useRef({ clock: 0, at: geo.spots.park as P3, from: geo.spots.park as P3, to: geo.spots.park as P3, since: 0, angle: 0, speed: 1, idle: IDLE_S, index: -1 });

  const test = shown[pick];
  const plan = test ? planOf(test) : null;

  useEffect(() => {
    if (!plan) return;
    const st = s.current;
    st.from = st.at;
    st.to = plan.tool === "pickup" ? geo.spots[plan.spot] : geo.spots.park;
    st.since = st.clock;
    st.index = pick;
  }, [pick, plan, geo]);

  const draw = (dt: number) => {
    const st = s.current;
    if (!test || !plan) return false;
    st.clock += dt;
    st.idle += dt;
    const age = st.clock - st.since;
    const carry = reduced ? 1 : ease(age / CARRY_S);
    const arrived = carry >= 1;
    const lift = Math.sin(Math.PI * carry) * 26;
    const base = lerp(st.from, st.to, carry);
    st.at = carry >= 1 ? st.to : [base[0], base[1], base[2] + lift];
    const hold = test.capture_s ?? SHOW_S;
    const held = arrived ? (age - CARRY_S) / hold : 0;

    // The motor runs except during a coast-down, once the pickup is in place.
    st.speed = follow(st.speed, plan.stops && arrived ? 0 : 1, dt, plan.stops ? 1.6 : 0.5, reduced);
    if (!reduced) st.angle += (dt / TURN_S) * Math.PI * 2 * st.speed;
    if (coupling.current) coupling.current.innerHTML = geo.coupling(st.angle);
    if (fan.current) fan.current.innerHTML = geo.fan(st.angle);
    if (tool.current) tool.current.innerHTML = geo.pickup(st.at);
    if (lead.current) lead.current.innerHTML = geo.lead(st.at);
    if (beam.current) beam.current.style.opacity = String(plan.tool === "thermometer" ? ease((age - 0.3) / 0.6) : 0);
    ring.current?.setAttribute("d", test.capture_s && arrived ? geo.ring(Math.min(1, held)) : "");

    // Light the step the figure is on: placing first, then the rest across the hold.
    const n = test.procedure.length;
    const step = !arrived ? 0 : Math.min(n - 1, 1 + Math.floor(Math.max(0, held) * (n - 1)));
    steps.current?.querySelectorAll("li").forEach((li, i) => {
      li.toggleAttribute("data-on", i === step);
      li.toggleAttribute("data-done", i < step);
    });
    if (readout.current) {
      const what = [SHORT[test.id] ?? test.name, minutes(test.effort_min), test.downtime === "none" ? "no stop" : test.downtime];
      if (test.capture_s) what.push(`${test.capture_s} s capture`);
      readout.current.textContent = what.join(" · ");
    }
    // Walk the catalogue when nobody is touching it.
    if (!reduced && st.idle > IDLE_S && held >= 1 + 1.4 / hold) {
      st.idle = IDLE_S;
      setPick((p) => (p + 1) % shown.length);
    }
    return !reduced || !arrived;
  };

  const kick = useLoop(draw, seen);
  useEffect(() => {
    draw(0);
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, pick, reduced]);

  if (!test || !plan) return <p className="muted">The engine sent no check this figure knows how to place.</p>;

  const choose = (i: number) => {
    s.current.idle = 0;
    setPick((i + shown.length) % shown.length);
  };

  return (
    <div className="col gap-3" ref={stage}>
      <Seg value={test.id} onChange={(v) => choose(shown.findIndex((t) => t.id === v))} options={shown.map((t) => ({ id: t.id, label: SHORT[t.id] ?? t.name, title: t.name }))} label="Which check" />
      <Plate
        fig="Fig 2"
        title="The check it asks for"
        hint="← → for the next check"
        readout={readout}
        keys={[
          { mark: "pick", label: "where the reading comes from" },
          { mark: "lit", label: "the coupling's key mark, to see the shaft turn" },
        ]}
        caption={
          <>
            Each check, its minutes and its downtime come from the engine's catalogue. The pickup goes where a check's own steps put it: the drive-end
            housing for the vibration and envelope captures, the mounting foot for the half-order check. The infrared sensor reads the housing for
            temperature, and the coast-down cuts the motor and records while the fan winds down. The ring on the phone fills over the capture's true length;
            only the shaft is slowed.
          </>
        }
        role="group"
        tabIndex={0}
        aria-label={`Checks the engine can ask for. Now: ${test.name}. Left and right arrows change the check.`}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") choose(pick + 1);
          else if (e.key === "ArrowLeft") choose(pick - 1);
          else return;
          e.preventDefault();
        }}
      >
        <svg className="iso-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={geo.label} id={id}>
          <Raw svg={geo.back} />
          <g ref={coupling} />
          <Raw svg={geo.shaftA + geo.blockDE + geo.shaftB + geo.blockNDE + geo.shaftC} />
          <g ref={fan} />
          <Raw svg={geo.hub + geo.front} />
          <path ref={ring} className="fx-ring" />
          <g ref={beam} style={{ opacity: 0 }}>
            <Raw svg={geo.beam} />
          </g>
          <g ref={tool} />
          <g ref={lead} />
        </svg>
      </Plate>
      <div className="col gap-1">
        <span className="small muted">{test.name}: the steps, as the engine gives them</span>
        <ol className="fx-steps" ref={steps}>
          {test.procedure.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
