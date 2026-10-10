/**
 * Client for a case's report (`GET /investigations/{id}/report`).
 *
 * Shapes mirror `agents/report.py`. Every line is written on the server: the
 * engine's own, or a model's sentence that passed the evidence check there.
 */

const BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:8080" : "");

export type Part =
  | "hazard"
  | "verdict"
  | "why"
  | "plain"
  | "limit"
  | "caveat"
  | "action"
  | "change";

export type ReportLine = {
  part: Part;
  text: string;
  /** Ledger ids, or the engine's own "verdict", "why" or "limit". */
  cites: string[];
  /** "engine", or the model that wrote the sentence. */
  by: string;
};

/** A sentence a model wrote that the evidence it cited did not back, and why. */
export type RemovedLine = { text: string; cites: string[]; why: string };

export type CaseReport = {
  case: string;
  outcome: "open" | "concluded" | "unresolved";
  lines: ReportLine[];
  removed: RemovedLine[];
  evidence: { id: string; kind: string; statement: string }[];
  /** The model whose sentences were checked. Empty when none ran. */
  explained_by: string;
  notes: string[];
};

/**
 * `engine` asks for the engine's lines alone, which is instant. `careless` runs
 * a test writer that makes false claims on purpose, to show the check.
 */
export async function caseReport(id: string, writer?: "engine" | "careless"): Promise<CaseReport> {
  const query = writer ? `?writer=${writer}` : "";
  const response = await fetch(`${BASE}/investigations/${id}/report${query}`);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as CaseReport;
}
