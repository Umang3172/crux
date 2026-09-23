/**
 * Thin client for the investigation API.
 *
 * The shapes here mirror `api/app.py::serialise`. Keep them in step: the UI is
 * allowed to be opinionated about layout, never about meaning.
 */

const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8080";

export type Hypothesis = {
  kind: string;
  label: string;
  posterior: number;
  correlation: number | null;
  rejected: boolean;
  supports: string[];
  tensions: string[];
};

export type LedgerEntry = {
  id: string;
  statement: string;
  value: number | string | null;
  unit: string;
  source: string;
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

export type Investigation = {
  id: string;
  machine: { id: string; name: string };
  rpm: number;
  hypotheses: Hypothesis[];
  ledger: LedgerEntry[];
  requested_tests: string[];
  outcomes: { test_id: string; feature: string; value: number }[];
  transcript: string[];
  conclusion: Conclusion | null;
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export const startInvestigation = (fault: string, severity = 1.0) =>
  post<Investigation>("/investigations", { fault, severity });

/** Runs a whole case, answered by the rig fixture. This is the judge's path. */
export const replay = (fault: string, severity = 0.35) =>
  post<Investigation>("/replay", { fault, severity });

export const submitEvidence = (id: string, testId: string, value: number) =>
  post<Investigation>(`/investigations/${id}/evidence`, {
    test_id: testId,
    value,
  });

export const health = async () =>
  (await fetch(`${BASE}/health`)).json() as Promise<{
    status: string;
    models: Record<string, string>;
  }>;
