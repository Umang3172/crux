/**
 * Client for the check after a repair (`POST /investigations/{id}/repair`).
 *
 * Shapes mirror `investigation/repair.py` and `api/app.py`. The answer is the
 * engine's verdict on a new capture; this file only carries it.
 */

import { Investigation } from "../api";

const BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:8080" : "");

export type RepairOutcome =
  | "verified"
  | "still_there"
  | "something_else"
  | "cause_gone"
  | "cannot_tell";

/** One line the repaired cause predicts: its peak in multiples of its floor. */
export type LineChange = { line: string; before: number; after: number; usual: number | null };

export type RepairCheck = {
  outcome: RepairOutcome;
  cause: string;
  found: string | null;
  belief: number | null;
  statement: string;
  /** What a "verified" could not have seen. Empty otherwise. */
  limit: string;
  limit_names_cause: boolean;
  lines: LineChange[];
  /** Where `usual` comes from: the machine's own healthy captures, or a simulation. */
  usual_from: "healthy captures" | "simulation";
  /** The capture after the repair, as a case of its own. */
  after: Investigation;
  /** Demo only: what the synthetic rig was given for the capture after the repair. */
  rig: { fault: string; severity: number } | null;
};

/** What the repair did, on the synthetic rig. */
export type RepairDone = { removed?: number; left_behind?: string };

export async function checkRepair(id: string, done: RepairDone): Promise<RepairCheck> {
  const response = await fetch(`${BASE}/investigations/${id}/repair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(done),
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* not JSON: keep the status line */
    }
    throw new Error(detail);
  }
  return (await response.json()) as RepairCheck;
}
