// What the demo pump is doing now, read from this browser's own record: its
// cases (engine cases read from the server, AI runs kept here), its work
// orders and any hazard nobody has acknowledged. The pump is never flagged on
// its vibration level: a healthy pump on a noisy floor reads the same, so the
// only things that change its status are a case, a work order or a hazard.

import type { AgentRun, CaseRecord, Investigation, RepairOutcome } from "../../api/types";
import { openRequest } from "../../demo/instrument";
import { openHazards, type CaseEntry, type WorkOrder, type World } from "../../demo/world";
import { pct } from "../../lib/format";
import { check, faultFull, fault, ranked } from "../../lib/plain";
import type { TagTone } from "../../ui/Tag";

export type CasePhase = "loading" | "lost" | "error" | "investigating" | "waiting" | "concluded" | "unresolved";

export type Loaded = { phase: "loading" } | { phase: "lost" } | { phase: "error" } | { phase: "ready"; inv: Investigation };

export type CaseSummary = {
  id: string;
  kind: "engine" | "ai";
  createdAt: number;
  story?: string;
  phase: CasePhase;
  /** The two suspects furthest ahead, as the engine ranks them. */
  leaders: { kind: string; belief: number }[];
  /** The cause the engine named, when it named one. */
  cause: string | null;
  belief: number | null;
  /** What the open request asks for. */
  checkName: string | null;
  /** Earlier cases on this pump, as the server remembers them. */
  history: CaseRecord[];
};

/** An engine case as the server holds it, or an AI run as this browser kept it. */
export function summarise(entry: CaseEntry, loaded: Loaded | undefined, run: AgentRun | undefined): CaseSummary {
  const base = { id: entry.id, kind: entry.kind, createdAt: entry.createdAt, story: entry.story, leaders: [], cause: null, belief: null, checkName: null, history: [] };
  if (entry.kind === "ai") {
    const view = run?.case;
    if (!run || !view) return { ...base, phase: "lost" };
    const leaders = [...view.suspects]
      .filter((s) => s.belief !== null)
      .sort((a, b) => (b.belief ?? 0) - (a.belief ?? 0))
      .slice(0, 2)
      .map((s) => ({ kind: s.name, belief: s.belief ?? 0 }));
    const waiting = view.requests.find((r) => r.status === "waiting");
    const phase: CasePhase = view.status === "open" ? (waiting ? "waiting" : "investigating") : view.status;
    return {
      ...base,
      phase,
      leaders,
      cause: view.status === "concluded" ? view.leader : null,
      belief: view.leader_belief,
      checkName: waiting ? waiting.test_name : null,
      history: run.history,
    };
  }
  if (!loaded || loaded.phase === "loading") return { ...base, phase: "loading" };
  if (loaded.phase !== "ready") return { ...base, phase: loaded.phase };
  const inv = loaded.inv;
  const open = openRequest(inv);
  const leaders = ranked(inv)
    .slice(0, 2)
    .map((h) => ({ kind: h.kind, belief: h.posterior }));
  return {
    ...base,
    phase: inv.outcome === "open" ? (open ? "waiting" : "investigating") : inv.outcome,
    leaders,
    cause: inv.conclusion?.root_cause ?? null,
    belief: inv.conclusion?.confidence ?? leaders[0]?.belief ?? null,
    checkName: open ? check(open.test_id).name : null,
    history: inv.history,
  };
}

export type StatusKey =
  | "normal"
  | "attention"
  | "investigating"
  | "waiting"
  | "order-waiting"
  | "repair-checked"
  | "verified"
  | "hazard"
  | "lost"
  | "checking"
  | "unreadable";

export type NowStatus = { key: StatusKey; label: string; tone: TagTone; detail: string };

const STATUS: Record<StatusKey, { label: string; tone: TagTone }> = {
  normal: { label: "Normal", tone: "safety" },
  attention: { label: "Needs attention", tone: "caution" },
  investigating: { label: "Being investigated", tone: "measure" },
  waiting: { label: "Waiting for a check", tone: "measure" },
  "order-waiting": { label: "Work order waiting", tone: "caution" },
  "repair-checked": { label: "Repair being checked", tone: "caution" },
  verified: { label: "Verified", tone: "safety" },
  hazard: { label: "Hazard reported", tone: "danger" },
  lost: { label: "Case lost", tone: "stock" },
  checking: { label: "Checking", tone: "stock" },
  unreadable: { label: "Can't read the case", tone: "stock" },
};

const status = (key: StatusKey, detail: string): NowStatus => ({ key, ...STATUS[key], detail });

/** What the repair check found, in the words the work order uses. */
const REPAIR: Record<Exclude<RepairOutcome, "">, string> = {
  verified: "The repair was verified.",
  still_there: "The repair was not verified: the fault is still there.",
  something_else: "That fault is gone, but something else shows.",
  cause_gone: "That fault is gone; the rest isn't settled.",
  cannot_tell: "The repair check could not settle it either way.",
};

const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

function ofCase(c: CaseSummary): NowStatus {
  const [a, b] = c.leaders;
  switch (c.phase) {
    case "investigating":
      return status("investigating", "A case is open and Crux is testing every suspect on a virtual copy.");
    case "waiting":
      return status(
        "waiting",
        a && b
          ? `Crux can't tell yet: ${lower(fault(a.kind).name)} ${pct(a.belief)} or ${lower(fault(b.kind).name)} ${pct(b.belief)}. It is waiting for one check${c.checkName ? `: ${lower(c.checkName)}` : ""}.`
          : "Crux is waiting for one check.",
      );
    case "concluded":
      return c.cause === "healthy"
        ? status("normal", `The last case found nothing wrong, at ${pct(c.belief)}.`)
        : status("attention", `Crux named ${c.cause ? faultFull(c.cause) : "a cause"} at ${pct(c.belief)}.`);
    case "unresolved":
      return status("attention", `Crux won't name a cause yet${a ? `. Leading suspect: ${lower(fault(a.kind).name)}, ${pct(a.belief)}` : ""}.`);
    case "lost":
      return status("lost", "The last case was kept in the server's memory and the server restarted. Start it again.");
    case "error":
      return status("unreadable", "The server didn't answer for the last case. Try again in a moment.");
    default:
      return status("checking", "Reading this pump's cases from the server.");
  }
}

function ofOrder(w: WorkOrder): NowStatus {
  const result = w.repair?.result.outcome;
  if (w.stage === "closed") return status("normal", result === "verified" ? "The repair was verified and the work order is closed." : "The work order is closed.");
  if (result === "verified") return status("verified", REPAIR.verified);
  if (result && w.stage !== "plan") return status("attention", REPAIR[result]);
  if (w.stage === "repair") return status("repair-checked", `Approved${w.approvedBy ? ` by ${w.approvedBy}` : ""}. The repair comes next, and then Crux checks it.`);
  if (w.stage === "check" || w.stage === "found") return status("repair-checked", "Crux is checking the repair.");
  return status("order-waiting", "A work order waits for a name to approve it.");
}

/**
 * The pump's status. A hazard outranks everything; after that the newest of
 * its latest work order and latest case speaks, since a work order belongs to
 * the case it came from.
 */
export function nowStatus(world: World, machine: string, cases: CaseSummary[]): NowStatus {
  const hazard = openHazards(world).find((h) => h.machine === machine);
  if (hazard) return status("hazard", hazard.text);
  const order = [...world.workOrders].filter((w) => w.machine === machine).sort((a, b) => b.createdAt - a.createdAt)[0];
  const latest = [...cases].sort((a, b) => b.createdAt - a.createdAt)[0];
  if (order && (!latest || order.createdAt >= latest.createdAt || order.caseId === latest.id)) return ofOrder(order);
  if (latest) return ofCase(latest);
  return status("normal", "Not investigated yet. Nothing is flagged: Crux looks at this pump when someone presses Investigate.");
}
