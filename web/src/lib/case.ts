// How a case reads as a story: which stages it has reached and which of the
// three forks it took. Derived from the engine's state only.

import type { CaseView, Considered, Investigation } from "../api/types";
import { openRequest } from "../demo/instrument";

export type StageId = "reading" | "suspects" | "experiments" | "check" | "answer";

export const STAGES: { id: StageId; label: string }[] = [
  { id: "reading", label: "Reading" },
  { id: "suspects", label: "Suspects" },
  { id: "experiments", label: "Virtual experiments" },
  { id: "check", label: "One check" },
  { id: "answer", label: "Answer" },
];

/**
 * ask: Crux could not tell the leaders apart and asked for a measurement.
 * settled: the first reading was enough; nobody was sent.
 * no-cause: Crux would not name a cause.
 */
export type Fork = "ask" | "settled" | "no-cause";

export function forkOf(inv: Investigation): Fork {
  if (inv.requested_tests.length > 0) return "ask";
  if (inv.outcome === "unresolved") return "no-cause";
  return "settled";
}

/** The furthest stage the engine has reached. */
export function reachedStage(inv: Investigation): StageId {
  if (inv.outcome !== "open") return "answer";
  if (openRequest(inv)) return "check";
  return "experiments";
}

export const stageIndex = (id: StageId) => STAGES.findIndex((s) => s.id === id);

/** The checks the engine weighed, the chosen one first. */
export function weighed(c: Considered[]): Considered[] {
  const order: Record<string, number> = { chosen: 0, less_per_minute: 1, leaders_too_close: 2, cannot_settle: 3, already_taken: 4, no_prediction: 5 };
  return [...c].sort((a, b) => (order[a.fate] ?? 9) - (order[b.fate] ?? 9));
}

/** "Can't take this reading" has no route yet, so nothing on screen offers it. */
export const CAN_DECLINE_CHECK = false;

/** The AI run's first step reads the case before any experiment and says nothing true yet. */
export function meaningfulSteps<T extends { tool: string; answered: string | null }>(steps: T[]): T[] {
  return steps.filter((s, i) => !(i < 2 && s.tool === "get_case" && /Nothing stands in the way/.test(s.answered ?? "")));
}

export function aiFork(c: CaseView): Fork {
  if (c.requests.length > 0) return "ask";
  if (c.status === "unresolved") return "no-cause";
  return "settled";
}
