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
  /** Which of the two agents made the call. */
  agent: "investigator" | "critic";
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
  /** The passage a written suspect was taken from, when it cites one. */
  source?: string | null;
};

export type AgentCase = {
  case_id: string;
  status: "open" | "concluded" | "unresolved";
  leader: string;
  leader_belief: number;
  conclude_at: number;
  blockers: string[];
  /** Why there is no verdict, in the physics' own words. */
  unresolved_reason: string | null;
  /** What the investigator gave as its reason for closing without one. */
  investigator_reason: string | null;
  /** Notes from people, which the investigator reads as data. */
  notes: { id: string; text: string; by: string; hazards: string[] }[];
  /** Set when a note describes a hazard. */
  hazard: string | null;
  /** Whether the critic was given this case. */
  critic_consulted?: boolean;
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
  /** Earlier closed cases on this machine, as known when this one opened. */
  history?: { case_id: string; sentence: string }[];
};

export type Tool = { name: string; does: string; takes: string[] };

export type Agent = { name: string; job: string; tools: string[] };

export type About = {
  models: Record<string, string>;
  tools: Tool[];
  /** The two agents and the tools each is given. */
  agents?: Agent[];
  limits: { rounds?: number; model_calls?: number; seconds?: number };
  scenarios: { id: string; on_the_list: boolean }[];
};

export type RunParams = {
  fault: string;
  severity: number;
  extra_noise: number;
  seed: number;
  /** A technician's note put on the case before the investigator starts. */
  note?: string;
  /** Whose machine this is: cases are remembered per plant. */
  plant?: string;
};

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
