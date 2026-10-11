// The case a work order was drafted from, read cheaply: the engine's own state
// for a person-answered case, or the run this browser kept for an AI-investigator
// case (the server's case door does not serve those).

import { ApiError } from "../../api/client";
import { getCase } from "../../api/crux";
import type { CaseView, Investigation, Note } from "../../api/types";
import { caseEntry, useWorld, type WorkOrder } from "../../demo/world";
import { useAsync } from "../../lib/hooks";

export type CaseCore = {
  loading: boolean;
  error: Error | null;
  /** The server no longer has the case: it was kept in memory and the server restarted. */
  lost: boolean;
  reload: () => void;
  inv: Investigation | null;
  view: CaseView | null;
  outcome: "concluded" | "unresolved" | "open" | null;
  /** The cause the engine named, by its id. */
  cause: string | null;
  belief: number | null;
  notes: Note[];
  hazard: string | null;
};

export function useCaseCore(wo: WorkOrder): CaseCore {
  const world = useWorld();
  const caseId = wo.caseId;
  const view = (caseId && world.runs[caseId]?.run.case) || null;
  const ai = caseId ? caseEntry(world, caseId)?.kind === "ai" || (!caseEntry(world, caseId) && view !== null) : false;
  const loaded = useAsync<Investigation | null>((signal) => (caseId && !ai ? getCase(caseId, signal) : Promise.resolve(null)), [caseId, ai]);

  const inv = loaded.data;
  const lost = !ai && loaded.error instanceof ApiError && loaded.error.status === 404;
  const named = inv ? inv.conclusion : view && view.status === "concluded" ? { root_cause: view.leader, confidence: view.leader_belief } : null;

  return {
    loading: !ai && loaded.loading,
    error: lost ? null : loaded.error,
    lost,
    reload: loaded.reload,
    inv,
    view: ai ? view : null,
    outcome: inv ? inv.outcome : ai && view ? view.status : null,
    cause: named?.root_cause ?? null,
    belief: named?.confidence ?? null,
    notes: inv?.notes ?? (ai ? view?.notes : undefined) ?? [],
    hazard: inv?.hazard ?? (ai ? view?.hazard : undefined) ?? null,
  };
}
