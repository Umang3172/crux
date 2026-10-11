// The plant clock: a "now" the visitor plays, pauses and scrubs. Play moves it
// at a steady number of readings a second, so a run of minutes and a run of
// weeks both unfold at a pace the eye can follow. Like a plant, it stops when
// an alarm fires: that is the moment to read the numbers, not to scroll past.

import { useCallback, useEffect, useRef, useState } from "react";

/** Readings that pass each second of play. */
const READINGS_PER_SECOND = 2;
/** The page repaints about this often, not on every frame. */
const PAINT_MS = 33;

export type PlantClock = {
  now: number;
  playing: boolean;
  play: () => void;
  pause: () => void;
  /** Move the clock and stop it. */
  seek: (hours: number) => void;
};

export function usePlantClock({
  initial,
  home,
  step,
  last,
  stops,
}: {
  initial: number;
  /** Where play starts over from once it has reached the end. */
  home: number;
  /** The typical gap between readings, in hours. */
  step: number;
  last: number;
  /** Hours at which play holds, once each: the alarms. */
  stops: number[];
}): PlantClock {
  const [now, setNow] = useState(initial);
  const [playing, setPlaying] = useState(false);
  const at = useRef(initial);
  // Alarms play has already stopped at, so pressing play again carries on past them.
  const held = useRef<Set<number>>(new Set(stops.filter((t) => t <= initial)));

  const seek = useCallback(
    (h: number) => {
      at.current = Math.min(h, last);
      for (const t of [...held.current]) if (t > at.current) held.current.delete(t);
      setPlaying(false);
      setNow(at.current);
    },
    [last],
  );

  const play = useCallback(() => {
    // Pressing play at the very end starts the replay over, from just before the alarm.
    if (at.current >= last) {
      at.current = home;
      held.current = new Set(stops.filter((t) => t <= home));
    }
    setNow(at.current);
    setPlaying(true);
  }, [home, last, stops]);

  const pause = useCallback(() => setPlaying(false), []);

  useEffect(() => {
    if (!playing) return;
    const rate = step * READINGS_PER_SECOND;
    let prev = performance.now();
    let painted = prev;
    let raf = 0;
    const tick = (t: number) => {
      const before = at.current;
      at.current = Math.min(last, at.current + ((t - prev) / 1000) * rate);
      prev = t;
      const alarm = stops.find((a) => a > before && a <= at.current && !held.current.has(a));
      if (alarm !== undefined) {
        held.current.add(alarm);
        at.current = alarm;
        setNow(alarm);
        setPlaying(false);
        return;
      }
      if (at.current >= last) {
        setNow(last);
        setPlaying(false);
        return;
      }
      if (t - painted >= PAINT_MS) {
        painted = t;
        setNow(at.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, step, last, stops]);

  return { now, playing, play, pause, seek };
}
