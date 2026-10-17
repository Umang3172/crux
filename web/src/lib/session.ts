// Each browser keeps its own session: the cases and agent runs it opened and
// what people recorded on them. The server keeps cases in one shared memory
// and forgets them on a restart, and it returns an agent run once without
// storing it, so the last known state of each case is kept here too.
// "Reset" starts a new session with a new plant id, which also gives the pump
// a fresh history of earlier cases on the server.

import { useSyncExternalStore } from "react";
import type { AgentRun, Investigation, RepairResult, RunParams } from "../api/types";
import type { Investigator } from "./scenarios";

export type Answerer = "virtual instrument" | "person" | "phone scan";

export type CaseEntry = {
  id: string;
  kind: Investigator;
  /** The plant machine the case is on (lib/plant.ts). */
  machine?: string;
  params: RunParams;
  /** The fault that was fed in is an answer key: hidden until a person reveals it. */
  revealed: boolean;
  scenario?: string;
  /** Part of an autonomous run. */
  batch?: string;
  createdAt: number;
  /** How long the opening request took, in milliseconds. */
  tookMs?: number;
  inv?: Investigation;
  run?: AgentRun;
  note?: string;
  /** Beliefs after each reading, keyed by how many readings the case had. */
  trail: Record<number, { kind: string; posterior: number }[]>;
  answered: Record<string, { by: Answerer; from: "here" | "phone"; at: number; value: number }>;
  repair?: { choice: string; at: number; result: RepairResult };
  approved?: { by: string; at: number };
  hazardAck?: { by: string; at: number };
  /** The server no longer holds this case (it keeps cases in memory). */
  lost?: boolean;
  /** An agent run opened from this page: shown as it happens before its result is. */
  watch?: boolean;
  /** Why an agent run did not finish. */
  failed?: string;
};

type Session = { v: 2; plant: string; cases: CaseEntry[] };

const KEY = "crux.console.v2";
const MAX_CASES = 40;

const newPlant = () => `web-${Math.random().toString(36).slice(2, 12)}`;
const fresh = (): Session => ({ v: 2, plant: newPlant(), cases: [] });

function load(): Session {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Session;
      if (s && s.v === 2 && Array.isArray(s.cases)) return s;
    }
  } catch {
    /* storage blocked or corrupt: start fresh in memory */
  }
  return fresh();
}

let session: Session = typeof window === "undefined" ? fresh() : load();
const listeners = new Set<() => void>();

function save() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // A full or blocked store must not break the console; the session lives on in memory.
  }
}

function update(fn: (s: Session) => Session) {
  session = fn(session);
  if (session.cases.length > MAX_CASES) session = { ...session, cases: session.cases.slice(-MAX_CASES) };
  save();
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      session = load();
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
};

export const getSession = () => session;
export const useSession = () => useSyncExternalStore(subscribe, getSession, getSession);
export const useCaseEntry = (id: string | undefined) => useSession().cases.find((c) => c.id === id);

export function resetSession() {
  session = fresh();
  save();
  listeners.forEach((l) => l());
}

const trailOf = (inv: Investigation) => inv.hypotheses.map((h) => ({ kind: h.kind, posterior: h.posterior }));

export function addCase(entry: Omit<CaseEntry, "createdAt" | "trail" | "answered">) {
  const trail = entry.inv ? { [entry.inv.outcomes.length]: trailOf(entry.inv) } : {};
  update((s) => ({ ...s, cases: [...s.cases.filter((c) => c.id !== entry.id), { ...entry, createdAt: Date.now(), trail, answered: {} }] }));
}

export function patchCase(id: string, patch: Partial<CaseEntry>) {
  update((s) => ({ ...s, cases: s.cases.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
}

/** Keep the latest state the server gave, and the beliefs at each number of readings. */
export function rememberInvestigation(inv: Investigation) {
  const c = session.cases.find((x) => x.id === inv.id);
  if (!c) return;
  const n = inv.outcomes.length;
  const same = c.inv && c.inv.outcome === inv.outcome && c.inv.outcomes.length === n && c.inv.notes.length === inv.notes.length && !c.lost;
  if (same && c.trail[n]) return;
  update((s) => ({
    ...s,
    cases: s.cases.map((x) => (x.id === inv.id ? { ...x, inv, lost: false, trail: x.trail[n] ? x.trail : { ...x.trail, [n]: trailOf(inv) } } : x)),
  }));
}

export function markAnswered(id: string, test: string, by: Answerer, from: "here" | "phone", value: number) {
  update((s) => ({
    ...s,
    cases: s.cases.map((c) => (c.id === id ? { ...c, answered: { ...c.answered, [test]: { by, from, at: Date.now(), value } } } : c)),
  }));
}

/** Cases with a reported hazard that nobody has acknowledged in this browser. */
export function openHazards(s: Session): { id: string; text: string }[] {
  return s.cases
    .map((c) => ({ id: c.id, text: c.inv?.hazard ?? c.run?.case?.hazard ?? null, ack: c.hazardAck }))
    .filter((h): h is { id: string; text: string; ack: undefined } => !!h.text && !h.ack)
    .map(({ id, text }) => ({ id, text }));
}
