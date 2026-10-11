// Reading a recorded run at "now". The recording holds the bearing's whole
// life, but a person watching the machine would know only what came before
// the plant clock, so every value here is taken at or before it. What lies
// after the clock is the answer key and is drawn only on request.

import { machine as fetchMachine } from "../../api/crux";
import type { MachineReplay, PartReplay, TimeLeft } from "../../api/types";

const cache = new Map<string, Promise<MachineReplay>>();

/** One fetch per recording, shared by the plant, the machine page and the run picker. */
export function loadReplay(id: string): Promise<MachineReplay> {
  let p = cache.get(id);
  if (!p) {
    p = fetchMachine(id);
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

/** Index of the last sample at or before `t` (0 when `t` comes before the first). */
export function indexAt(ts: number[], t: number): number {
  if (ts.length === 0 || t < ts[0]) return 0;
  let lo = 0;
  let hi = ts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export type PartNow = {
  part: PartReplay;
  index: number;
  percent: number;
  /** Vibration as a multiple of this part's own healthy level. */
  level: number;
  alarmed: boolean;
  /** The latest time-left range given at or before now; only after the alarm. */
  range: TimeLeft | null;
};

export function partAt(part: PartReplay, now: number): PartNow {
  const index = indexAt(part.t_h, now);
  const alarmed = part.alarm_h !== null && part.alarm_h <= now;
  let range: TimeLeft | null = null;
  if (alarmed) {
    for (const r of part.time_left) {
      if (r.at_h > now) break;
      if (r.p50_h !== null) range = r;
    }
  }
  return { part, index, percent: part.percent[index] ?? 100, level: part.level[index] ?? 1, alarmed, range };
}

/** A machine is as healthy as its worst part, and a part the watcher has flagged comes first. */
export function worstPart(parts: PartNow[]): PartNow {
  return [...parts].sort((a, b) => Number(b.alarmed) - Number(a.alarmed) || a.percent - b.percent)[0];
}

export const startOf = (r: MachineReplay) => Math.min(...r.parts.map((p) => p.t_h[0] ?? 0));
export const lastOf = (r: MachineReplay) => Math.max(...r.parts.map((p) => p.t_h[p.t_h.length - 1] ?? 0));

export function firstAlarm(r: MachineReplay): number | null {
  const alarms = r.parts.map((p) => p.alarm_h).filter((a): a is number => a !== null);
  return alarms.length ? Math.min(...alarms) : null;
}

/** The typical gap between readings, so play runs at a steady number of readings a second. */
export function stepOf(r: MachineReplay): number {
  const ts = r.parts[0]?.t_h ?? [];
  const gaps = ts.slice(1).map((t, i) => t - ts[i]).filter((g) => g > 0).sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0.1;
}

/** Readings before the alarm at which the replay opens: a few seconds of play from the alarm. */
const LEAD_READINGS = 10;

/** Where the plant clock stands before anyone touches it: just before the first alarm. */
export function defaultNow(r: MachineReplay): number {
  const a = firstAlarm(r);
  const part = (a === null ? r.parts[0] : r.parts.find((p) => p.alarm_h === a)) ?? r.parts[0];
  const i = a === null ? Math.floor(part.t_h.length * 0.6) : Math.max(0, indexAt(part.t_h, a) - LEAD_READINGS);
  return part.t_h[i] ?? 0;
}

/**
 * How far right the chart reaches. It comes from the first forecasts after
 * the alarm, never from the failure time, so the axis does not give the
 * answer away. Null when no part ever raised an alarm.
 */
function lookAhead(r: MachineReplay): number | null {
  let far: number | null = null;
  for (const p of r.parts) {
    for (const t of p.time_left.slice(0, 8)) {
      if (t.p90_h === null) continue;
      far = Math.max(far ?? 0, t.at_h + t.p90_h);
    }
  }
  return far;
}

export type Zoom = "final" | "whole";

/** The hours the chart covers: the final stretch around the alarm, or the whole recording to the same right edge. */
export function chartDomain(r: MachineReplay, zoom: Zoom, now: number): [number, number] {
  const t0 = startOf(r);
  const alarm = firstAlarm(r);
  const far = lookAhead(r);
  if (alarm === null || far === null) return [t0, Math.max(lastOf(r), now)];
  let end = alarm + (far - alarm) * 1.05;
  const span = end - alarm;
  const start = zoom === "whole" ? t0 : Math.max(t0, alarm - span * 0.55);
  if (now > end) end = now + (end - start) * 0.03;
  return [start, end];
}

/** The part to open on: the one that raises the first alarm, else the first. */
export function defaultPart(r: MachineReplay): PartReplay {
  const a = firstAlarm(r);
  return r.parts.find((p) => p.alarm_h === a && a !== null) ?? r.parts[0];
}

/** The server's sentence for a forecast that has already run out. */
export const isOverLine = (range: TimeLeft | null) => !!range && range.p90_h !== null && range.p90_h <= 0.02;

/** XJTU-SY runs carry the measured calibration; no other kind of run has one. */
export const isXjtu = (machineId: string) => machineId.startsWith("xjtu/");
