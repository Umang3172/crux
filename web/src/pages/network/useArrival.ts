// The one authored moment of the page: an update that has just arrived from
// the hub travels to this site's test, stops there while its numbers count,
// shows its verdict, and moves on to the person who decides. Every step shows
// something the server already reported; the timers only pace how it is shown.
// Under reduced motion, and for an update that was already waiting when the
// page opened, the page is simply in its final state.

import { useEffect, useState } from "react";
import { useReducedMotion } from "../../lib/hooks";

export const STEP = { hub: 0, travel: 1, count: 2, verdict: 3, onward: 4, settled: 5 } as const;

/** Milliseconds from the arrival at which each step begins. */
const BEGINS = [0, 60, 800, 1900, 2500, 3300];

export function useArrival(run: number | null): number {
  const reduce = useReducedMotion();
  const [seen, setSeen] = useState<{ run: number | null; step: number }>({ run: null, step: STEP.settled });

  useEffect(() => {
    if (run === null || reduce) return;
    const timers = BEGINS.slice(1).map((ms, i) => window.setTimeout(() => setSeen({ run, step: i + 1 }), ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [run, reduce]);

  // A new run starts at the hub in the very render that announces it.
  if (run === null || reduce) return STEP.settled;
  return seen.run === run ? seen.step : STEP.hub;
}
