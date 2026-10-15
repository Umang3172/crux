// One shape for a case, whoever investigated it. The engine returns an
// `Investigation`; an agent run returns a `CaseView`. Pages read this model so
// both kinds are shown the same way. Nothing here is computed beyond sorting
// and naming: every value is the server's.

import type { AgentRun, CaseRecord, CatalogTest, Investigation, Note, TestRequest } from "../api/types";
import { openRequest } from "./instrument";
import { CONCLUDE_AT } from "./plain";
import type { CaseEntry } from "./session";

export type SuspectState = "leading" | "live" | "ruled_out" | "unseen" | "refused" | "untested";

export type SuspectRow = {
  kind: string;
  label: string;
  origin: "catalogue" | "written";
  belief: number | null;
  /** How well the simulated spectrum matches the measured one. A picture, not what beliefs come from. */
  match: number | null;
  state: SuspectState;
  supports: string[];
  tensions: string[];
  /** The document passage a written suspect cites. */
  source: string | null;
};

export type LedgerRow = { id: string; statement: string; value: number | string | null; unit: string; source: string; at?: string };

export type CheckRow = {
  testId: string;
  name: string;
  status: "waiting" | "answered" | "unanswerable";
  reading: number | null;
  by: string | null;
  minutes: number | null;
  downtime: string | null;
};

export type CaseStatus = "waiting" | "open" | "concluded" | "unresolved";

export type CaseModel = {
  id: string;
  kind: "engine" | "agents";
  rpm: number;
  status: CaseStatus;
  concludeAt: number;
  suspects: SuspectRow[];
  leader: SuspectRow | null;
  ledger: LedgerRow[];
  checks: CheckRow[];
  /** The engine's request still waiting for a reading. Engine cases only. */
  request: TestRequest | null;
  /** The last request made, kept after a verdict so the picture of it can still be drawn. */
  lastRequest: TestRequest | null;
  transcript: string[];
  notes: Note[];
  hazard: string | null;
  history: CaseRecord[];
  unresolvedReason: string | null;
  experiments: number;
};

const byBelief = (a: SuspectRow, b: SuspectRow) => (b.belief ?? -1) - (a.belief ?? -1);

export function fromInvestigation(inv: Investigation, entry?: CaseEntry, catalogue?: CatalogTest[] | null): CaseModel {
  const unseen = new Set((inv.conclusion?.cannot_exclude ?? []).map((c) => c.kind));
  const top = [...inv.hypotheses].sort((a, b) => b.posterior - a.posterior)[0];
  const suspects: SuspectRow[] = inv.hypotheses
    .map((h) => ({
      kind: h.kind,
      label: h.label,
      origin: h.origin,
      belief: h.posterior,
      match: h.correlation,
      state: (h.kind === top?.kind && !h.rejected ? "leading" : unseen.has(h.kind) ? "unseen" : h.rejected ? "ruled_out" : "live") as SuspectState,
      supports: h.supports,
      tensions: h.tensions,
      source: null,
    }))
    .sort(byBelief);
  const open = openRequest(inv);
  const seen: Record<string, number> = {};
  const checks: CheckRow[] = inv.requested_tests.map((t) => {
    const nth = (seen[t] = (seen[t] ?? 0) + 1);
    const answers = inv.outcomes.filter((o) => o.test_id === t);
    const answer = answers[nth - 1];
    const cat = catalogue?.find((c) => c.id === t);
    const considered = inv.request?.considered.find((c) => c.test_id === t);
    return {
      testId: t,
      name: cat?.name ?? considered?.name ?? t,
      status: answer ? "answered" : "waiting",
      reading: answer?.value ?? null,
      by: answer ? (entry?.answered[t]?.by ?? null) : null,
      minutes: cat?.effort_min ?? considered?.minutes ?? null,
      downtime: cat?.downtime ?? considered?.downtime ?? null,
    };
  });
  return {
    id: inv.id,
    kind: "engine",
    rpm: inv.rpm,
    status: inv.outcome === "open" ? (open ? "waiting" : "open") : inv.outcome,
    concludeAt: CONCLUDE_AT,
    suspects,
    leader: suspects[0] ?? null,
    ledger: inv.ledger,
    checks,
    request: open,
    lastRequest: inv.request,
    transcript: inv.transcript,
    notes: inv.notes,
    hazard: inv.hazard,
    history: inv.history,
    unresolvedReason: inv.unresolved_reason ?? inv.no_test?.reason ?? null,
    experiments: inv.ledger.filter((l) => l.source === "virtual_experiment").length,
  };
}

export function fromRun(run: AgentRun): CaseModel | null {
  const c = run.case;
  if (!c) return null;
  const suspects: SuspectRow[] = c.suspects
    .map((s) => ({
      kind: s.name,
      label: s.label,
      origin: s.origin,
      belief: s.belief,
      match: s.simulation_match,
      state: (s.name === c.leader && s.status === "live" ? "leading" : s.status === "rejected" ? "ruled_out" : s.status) as SuspectState,
      supports: [],
      tensions: [],
      source: s.source,
    }))
    .sort(byBelief);
  const waiting = c.requests.some((r) => r.status === "waiting");
  return {
    id: c.case_id,
    kind: "agents",
    rpm: c.rpm,
    status: c.status === "open" ? (waiting ? "waiting" : "open") : c.status,
    concludeAt: c.conclude_at,
    suspects,
    leader: suspects.find((s) => s.kind === c.leader) ?? suspects[0] ?? null,
    ledger: c.evidence,
    checks: c.requests.map((r) => ({
      testId: r.test_id,
      name: r.test_name,
      status: r.status,
      reading: r.reading,
      by: r.collected_by,
      minutes: r.effort_min,
      downtime: r.downtime,
    })),
    request: null,
    lastRequest: null,
    transcript: c.transcript,
    notes: c.notes,
    hazard: c.hazard,
    history: run.history,
    unresolvedReason: c.unresolved_reason,
    experiments: c.evidence.filter((l) => l.source === "virtual_experiment").length,
  };
}

export function modelOf(entry: CaseEntry | undefined, catalogue?: CatalogTest[] | null): CaseModel | null {
  if (!entry) return null;
  if (entry.kind === "agents") return entry.run ? fromRun(entry.run) : null;
  return entry.inv ? fromInvestigation(entry.inv, entry, catalogue) : null;
}

export const STATUS_LABEL: Record<CaseStatus, string> = {
  waiting: "Waiting for a measurement",
  open: "Investigating",
  concluded: "Cause named",
  unresolved: "No cause named",
};

export const STATUS_TONE = {
  waiting: "warn",
  open: "accent",
  concluded: "ok",
  unresolved: "neutral",
} as const;
