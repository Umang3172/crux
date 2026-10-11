// Where the visitor left the plant clock, so the plant's bearing tile and the
// machine page agree. It is kept for this tab and for this demo world: a reset
// starts a new world, which starts the replay again from just before the alarm.

import { getWorld } from "../../demo/world";

const key = (run: string) => `crux.clock.${getWorld().plant}.${run}`;

export function readClock(run: string): number | null {
  try {
    const raw = window.sessionStorage.getItem(key(run));
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writeClock(run: string, hours: number): void {
  try {
    window.sessionStorage.setItem(key(run), String(hours));
  } catch {
    // Storage may be blocked; the clock then simply starts over next visit.
  }
}
