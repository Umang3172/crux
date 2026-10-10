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

// ------------------------------------------------------------------ tickets

export type Evidence = { id: string; kind: string; statement: string; numbers: number[] };
export type Sentence = { text: string; cites: string[] };
export type CameraFinding = { what: string; where: string; confidence: number; hazard: boolean };
export type CameraLook = {
  camera: string;
  taken_at: string;
  findings: CameraFinding[];
  inspected_by: string;
  note: string;
};

export type Ticket = {
  id: string;
  machine: string;
  machine_name: string;
  part: string;
  part_label: string;
  at_h: number;
  status: "draft" | "approved";
  fix_within_h: [number, number] | null;
  likely_h: number | null;
  stop_in_h: number | null;
  risk_before_stop: number | null;
  sentences: Sentence[];
  removed: Sentence[];
  evidence: Evidence[];
  camera: CameraLook | null;
  has_still: boolean;
  written_by: string;
  safety: string;
  approved_by: string;
  hazard: boolean;
  notes: string[];
};

async function send<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail ?? `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export const risk = (machine: string, part: string, at_h: number, stop_in_h: number) =>
  get<{ risk: number | null; note: string }>(
    `/maintenance/risk?${new URLSearchParams({
      machine,
      part,
      at_h: String(at_h),
      stop_in_h: String(stop_in_h),
    })}`,
  );

export const draftTicket = (
  machine: string,
  part: string,
  at_h: number,
  stop_in_h: number | null,
) => send<Ticket>("/maintenance/tickets", { machine, part, at_h, stop_in_h });

export const approveTicket = (id: string, by: string) =>
  send<Ticket>(`/maintenance/tickets/${id}/approve`, { by });

export const stillUrl = (id: string) => `${BASE}/maintenance/tickets/${id}/still`;

// ------------------------------------------------------------------ investigation

export type Finding = {
  confident: boolean;
  leader: { kind: string; label: string; belief: number };
  ranked: { kind: string; label: string; belief: number }[];
  asked: string[];
  answered: { test: string; value: number }[];
  transcript: string[];
  statement: string;
  reading: string;
};

export const investigate = (machine: string, part: string, at_h: number) =>
  send<Finding>("/maintenance/investigate", { machine, part, at_h });

// ------------------------------------------------------------------ learning across sites

export type Score = {
  model: string;
  error: number | null;
  late: number | null;
  inside: number | null;
};
export type Report = {
  passes: boolean | null;
  reason: string;
  runs?: number;
  current?: Score;
  candidate?: Score;
};
export type FleetStatus = {
  site: string;
  active: number | null;
  staged: { version: number; report: Report } | null;
  history: { version: number | null; approved_by: string; at: string }[];
  hub_versions: number[];
  lessons: number;
  model: string;
};
export type Lesson = {
  id: string;
  machine_type: string;
  title: string;
  when: string;
  do: string;
  avoid: string;
  outcome: "success" | "failure";
  source: string;
  confirmed_by: string;
};

export const fleetStatus = () => get<FleetStatus>("/fleet/status");
export const fleetPull = () =>
  send<{
    alerts: { version: number; lessons: string[] }[];
    staged: unknown;
    rejected: { why: string }[];
  }>("/fleet/pull", {});
export const fleetApprove = (by: string) => send<{ active: number }>("/fleet/approve", { by });
export const fleetRollback = (by: string) =>
  send<{ active: number | null }>("/fleet/rollback", { by });
export const fleetLessons = (machine_type: string) =>
  get<Lesson[]>(`/fleet/lessons?${new URLSearchParams({ machine_type, k: "20" })}`);
export const reportOutcome = (
  ticket_id: string,
  found: string,
  right: boolean,
  by: string,
  major: boolean,
) =>
  send<{ lesson: Lesson; sent_to_hub: boolean; alert: string | null }>("/fleet/outcome", {
    ticket_id,
    found,
    right,
    by,
    major,
  });
