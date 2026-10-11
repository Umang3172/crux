// The wording of a recorded run: hours, time-left ranges and the calibration
// line. Plain words; every number comes from the recording or the server.

import type { MachineReplay, TimeLeft } from "../../api/types";
import { num } from "../../lib/format";
import { isXjtu } from "./replay";

/** One decimal under ten hours, whole hours above. */
export function hourFigure(h: number): string {
  return h < 10 ? num(h, 1) : String(Math.round(h));
}

/** "0.2 to 2.8 hours", or days once the range is long. */
export function rangeText(r: TimeLeft): string {
  if (r.p10_h === null || r.p90_h === null) return "no estimate yet";
  if (r.p90_h >= 72) return `${num(r.p10_h / 24, 1)} to ${num(r.p90_h / 24, 1)} days`;
  return `${hourFigure(r.p10_h)} to ${hourFigure(r.p90_h)} hours`;
}

export function likelyText(r: TimeLeft): string | null {
  if (r.p50_h === null || r.p50_h <= 0.02) return null;
  return r.p50_h >= 72 ? `about ${num(r.p50_h / 24, 1)} days` : `about ${hourFigure(r.p50_h)} hours`;
}

/**
 * How often a range like this held, measured. Only the XJTU-SY runs carry the
 * measurement (the forecaster was tested on them one bearing at a time); a
 * different kind of run says plainly that nobody has measured it.
 */
export function calibration(replay: MachineReplay, synthetic: boolean): string {
  if (synthetic) return "This life comes from a physics model, so how often such a range holds has not been measured.";
  if (isXjtu(replay.machine)) {
    return "On held-out XJTU-SY bearings the truth fell inside such a range 42% of the time, against an aim of 80%.";
  }
  return "How often such a range holds has not been measured on this kind of run.";
}

/** The running hour as a short label. */
export const hourLabel = (h: number) => `hour ${num(h, 1)}`;

/** Sentence case for a raw label such as a failure mode. */
export const sentence = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
