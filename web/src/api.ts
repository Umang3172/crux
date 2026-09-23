/**
 * Thin client for the investigation API.
 *
 * The shapes here mirror `api/app.py::serialise`. Keep them in step: the UI is
 * allowed to be opinionated about layout, never about meaning. If a number has
 * to be *calculated* before it can be shown, that calculation belongs in the
 * engine, where it is tested and can be argued with.
 */

// Same origin in production: the container serves this bundle and the API from
// one URL, which is the link a judge is handed. VITE_API_BASE points a dev
// server at an API running somewhere else.
const BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:8080" : "");

export type Hypothesis = {
  kind: string;
  label: string;
  posterior: number;
  correlation: number | null;
  rejected: boolean;
  supports: string[];
  tensions: string[];
};

export type EvidenceSource =
  | "sensor"
  | "physics"
  | "virtual_experiment"
  | "human_measurement"
  | "operator";

export type LedgerEntry = {
  id: string;
  statement: string;
  value: number | string | null;
  unit: string;
  source: EvidenceSource | string;
  at: string;
};

export type Conclusion = {
  root_cause: string;
  confidence: number;
  reasoning: string;
  recommended_action: string;
  what_would_change_my_mind: string;
  evidence_ids: string[];
};

export type Outcome = { test_id: string; feature: string; value: number };

export type Investigation = {
  id: string;
  machine: { id: string; name: string };
  rpm: number;
  hypotheses: Hypothesis[];
  ledger: LedgerEntry[];
  requested_tests: string[];
  outcomes: Outcome[];
  transcript: string[];
  conclusion: Conclusion | null;
};

/** One row of `GET /tests`: a measurement the agent is allowed to ask for. */
export type EvidenceTest = {
  id: string;
  name: string;
  feature: string;
  effort_min: number;
  downtime: string;
  coach_prompt: string;
  procedure: string[];
  predictions: Record<string, number>;
};

export type Health = { status: string; models: Record<string, string> };

/** Real against simulated, for the spectrum plot. See `deploy/server.py`. */
export type Spectra = {
  band: "raw" | "envelope";
  hypothesis: string;
  f_max_hz: number;
  freq_hz: number[];
  real: number[];
  simulated: number[];
};

export type RunParams = {
  fault: string;
  severity: number;
  seed: number;
};

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, init);
  if (!response.ok) throw new Error(`${path} → ${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

const post = <T,>(path: string, body: unknown) =>
  json<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const health = () => json<Health>("/health");

export const catalogue = () => json<EvidenceTest[]>("/tests");

/** Opens a case: observe, run the virtual experiments, request a measurement. */
export const startInvestigation = (p: RunParams) => post<Investigation>("/investigations", p);

/** Hand back a measurement the agent asked for; the engine moves the belief. */
export const submitEvidence = (id: string, testId: string, value: number) =>
  post<Investigation>(`/investigations/${id}/evidence`, { test_id: testId, value });

/** Runs a whole case answered by the rig fixture. The judge's one-click path. */
export const replay = (p: RunParams) => post<Investigation>("/replay", p);

/**
 * Optional: the container entrypoint serves this, `hypengine serve` does not.
 * Returns null rather than throwing so the rest of the view still renders.
 */
export async function spectra(p: RunParams, hypothesis: string, band: "raw" | "envelope") {
  try {
    return await post<Spectra>("/spectrum", { ...p, hypothesis, band });
  } catch {
    return null;
  }
}
