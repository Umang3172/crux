/**
 * Client for the predictive maintenance endpoints (`api/maintenance.py`).
 *
 * Shapes mirror `forecast/replay.py`. Every number is computed there; this file
 * and the view only choose how to draw it.
 */

const BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:8080" : "");

/** A time-left range given at running hour `at_h`. Null: no finite answer. */
export type TimeLeft = {
  at_h: number;
  p10_h: number | null;
  p50_h: number | null;
  p90_h: number | null;
  note: string;
};

export type PartReplay = {
  part: string;
  label: string;
  failed: boolean;
  failure_mode: string;
  end_h: number;
  alarm_h: number | null;
  t_h: number[];
  percent: number[];
  level: number[];
  time_left: TimeLeft[];
  method: string;
};

export type MachineReplay = {
  machine: string;
  name: string;
  source: string;
  end_h: number;
  parts: PartReplay[];
};

export type MachineSummary = {
  machine: string;
  name: string;
  source: string;
  end_h: number;
  parts: number;
  failed: string[];
  lowest_percent: number;
};

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

export const machines = () =>
  get<{ machines: MachineSummary[]; note: string }>("/maintenance/machines");

export const machine = (id: string) => get<MachineReplay>(`/maintenance/machines/${encodeURI(id)}`);
