// Motion helpers shared by the figures: one frame loop that runs only while the
// figure is on screen and something moves, and the envelopes that keep a knock
// or a flash from popping in or out.

import { useEffect, useRef } from "react";

/** Exponential follow toward a target with time constant `tau` seconds. */
export const follow = (x: number, target: number, dt: number, tau: number, calm: boolean) =>
  calm ? target : x + (target - x) * (1 - Math.exp(-dt / tau));

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** An event's envelope by its age: a smooth rise over `rise` seconds, then an exponential fall. */
export const burst = (age: number, rise: number, fall: number) =>
  age < 0 ? 0 : age < rise ? smooth(0, rise, age) : Math.exp(-(age - rise) / fall);

/**
 * Run `tick(dt)` every frame while `running`. `dt` is clamped so a tab coming
 * back from the background does not jump. `tick` returns false to stop; `kick`
 * starts it again.
 */
export function useLoop(tick: (dt: number) => boolean, running: boolean) {
  const fn = useRef(tick);
  fn.current = tick;
  const frame = useRef(0);
  const last = useRef(0);
  const live = useRef(running);
  live.current = running;
  const step = (now: number) => {
    const dt = last.current ? Math.min((now - last.current) / 1000, 1 / 30) : 1 / 60;
    last.current = now;
    const more = fn.current(dt);
    frame.current = live.current && more ? requestAnimationFrame(step) : 0;
  };
  const kick = () => {
    if (frame.current || !live.current) return;
    last.current = 0;
    frame.current = requestAnimationFrame(step);
  };
  useEffect(() => {
    if (running) kick();
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  return kick;
}
