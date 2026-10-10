/**
 * Client for the investigator endpoints (`/agent/about`, `/agent/replay`).
 *
 * Shapes mirror `api/app.py` and `tools/contract.py`. Every sentence in a run's
 * steps is written on the server from a tool result (`agents/trace.py`); this
 * file and the view only choose how to show it.
 */

const BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:8080" : "");

/** One tool call: what the model asked for and what the tools answered. */
export type Step = {
  by: string;
  tool: string;
  /** "says" is the model's own narration; "asks" is a call into the physics. */
  kind: "asks" | "says";
  asked: string;
  answered: string | null;
};

export type Suspect = {
  name: string;
  label: string;
  origin: "catalogue" | "written";
  status: "live" | "rejected" | "untested" | "refused";
  /** Set by the physics. Null for a written suspect it has not simulated. */
  belief: number | null;
};

export type AgentCase = {
  case_id: string;
  status: "open" | "concluded" | "unresolved";
  leader: string;
  leader_belief: number;
  conclude_at: number;
  blockers: string[];
  unresolved_reason: string | null;
  suspects: Suspect[];
};

export type AgentRun = {
  model: string;
  /** True when a Gemini model made every call. */
  live: boolean;
  /** Why the offline investigator took the case over, if it did. */
  fallback: string | null;
  rounds: number;
  stopped: string | null;
  steps: Step[];
  thoughts: string[];
  ground_truth: string;
  case: AgentCase | null;
};

export type Tool = { name: string; does: string; takes: string[] };

export type About = {
  models: Record<string, string>;
  tools: Tool[];
  limits: { rounds?: number; model_calls?: number; seconds?: number };
  scenarios: { id: string; on_the_list: boolean }[];
};

export type RunParams = { fault: string; severity: number; extra_noise: number; seed: number };

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, init);
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* not JSON: keep the status line */
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export const about = () => json<About>("/agent/about");

export const investigate = (p: RunParams) =>
  json<AgentRun>("/agent/replay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(p),
  });
