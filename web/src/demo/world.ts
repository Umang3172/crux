// Each browser keeps its own demo world: the cases, AI runs and work orders it
// opened, and what people recorded in it. The server keeps cases in one
// shared memory, so without this every judge would see every other judge's
// cases. "Reset demo" starts a new world with a new plant id, which also gives
// the pump a fresh history of past cases on the server.

import { useSyncExternalStore } from "react";
import type { AgentRun, FaultKind, Investigation, OffListFault, RepairResult, RunParams, TestId, TestRequest } from "../api/types";

export type Answerer = "virtual instrument" | "person" | "live sensor";

export type CaseEntry = {
  id: string;
  /** engine: the physics engine with a person answering; ai: the AI investigator. */
  kind: "engine" | "ai";
  machine: string;
  story?: string;
  params: RunParams & { fault: FaultKind | OffListFault };
  /** Try-it cases where the visitor chose not to see the fault until the end. */
  hidden: boolean;
  revealed: boolean;
  createdAt: number;
  /** Readings this browser sent, so the case page can say where an answer came from. */
  answered: Partial<Record<TestId, { by: Answerer; from: "here" | "phone"; at: number }>>;
  /**
   * Beliefs and the open request after each reading, keyed by how many readings
   * the case had. The server keeps only the latest state; these let the page
   * replay how the beliefs moved, the same way every time.
   */
  snapshots: Record<number, Snapshot>;
};

export type Snapshot = {
  beliefs: { kind: string; label: string; origin: "catalogue" | "written"; posterior: number; rejected: boolean }[];
  request: TestRequest | null;
  at: number;
};

export type WorkOrderStage = "plan" | "repair" | "check" | "found" | "closed";

export type WorkOrder = {
  id: string;
  kind: "case" | "ticket";
  caseId?: string;
  ticketId?: string;
  machine: string;
  title: string;
  createdAt: number;
  stage: WorkOrderStage;
  approvedBy?: string;
  approvedAt?: number;
  repair?: { choice: "good" | "half" | "misaligned" | "live"; at: number; result: RepairResult };
  found?: { text: string; right: boolean; major: boolean; by: string; at: number };
  closedAt?: number;
};

export type HazardAck = { caseId: string; by: string; at: number };

/** A hazard someone reported in a note; it stays on top until a person acknowledges it. */
export type Hazard = { caseId: string; machine: string; text: string; at: number };

export type World = {
  v: 1;
  plant: string;
  cases: CaseEntry[];
  runs: Record<string, { run: AgentRun; note: string }>;
  workOrders: WorkOrder[];
  acks: HazardAck[];
  hazards: Hazard[];
  seen: Record<string, boolean>;
};

const KEY = "crux.world.v1";
const MAX_RUNS = 12;

const newPlant = () => `web-${Math.random().toString(36).slice(2, 12)}`;
const fresh = (): World => ({ v: 1, plant: newPlant(), cases: [], runs: {}, workOrders: [], acks: [], hazards: [], seen: {} });

function load(): World {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const w = JSON.parse(raw) as World;
      if (w && w.v === 1) return { ...fresh(), ...w };
    }
  } catch {
    /* storage blocked or corrupt: start fresh in memory */
  }
  return fresh();
}

let world: World = typeof window === "undefined" ? fresh() : load();
const listeners = new Set<() => void>();

function save() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(world));
  } catch {
    // A full or blocked store must not break the demo; the world lives on in memory.
  }
}

export function update(fn: (w: World) => World) {
  world = fn(world);
  const ids = Object.keys(world.runs);
  if (ids.length > MAX_RUNS) {
    const keep = new Set(world.cases.filter((c) => c.kind === "ai").slice(-MAX_RUNS).map((c) => c.id));
    world = { ...world, runs: Object.fromEntries(Object.entries(world.runs).filter(([id]) => keep.has(id))) };
  }
  save();
  listeners.forEach((l) => l());
}

export function resetDemo() {
  world = fresh();
  save();
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      world = load();
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
};

export const getWorld = () => world;
export const useWorld = () => useSyncExternalStore(subscribe, getWorld, getWorld);

// Small helpers the pages share

export function addCase(c: Omit<CaseEntry, "createdAt" | "answered" | "revealed" | "snapshots">, first?: Investigation) {
  const snapshots: Record<number, Snapshot> = first ? { [first.outcomes.length]: snapshotOf(first) } : {};
  update((w) => ({
    ...w,
    cases: [
      ...w.cases.filter((x) => x.id !== c.id),
      { ...c, createdAt: Date.now(), answered: {}, revealed: !c.hidden, snapshots },
    ],
  }));
}

export function snapshotOf(inv: Investigation): Snapshot {
  return {
    beliefs: inv.hypotheses.map((h) => ({
      kind: h.kind,
      label: h.label,
      origin: h.origin,
      posterior: h.posterior,
      rejected: h.rejected,
    })),
    request: inv.request,
    at: Date.now(),
  };
}

/** Keep the first state seen at each number of readings. */
export function recordSnapshot(inv: Investigation) {
  const c = world.cases.find((x) => x.id === inv.id);
  if (!c || c.snapshots[inv.outcomes.length]) return;
  update((w) => ({
    ...w,
    cases: w.cases.map((x) =>
      x.id === inv.id ? { ...x, snapshots: { ...x.snapshots, [inv.outcomes.length]: snapshotOf(inv) } } : x,
    ),
  }));
}

export function raiseHazard(h: Omit<Hazard, "at">) {
  if (world.hazards.some((x) => x.caseId === h.caseId && x.text === h.text)) return;
  update((w) => ({ ...w, hazards: [...w.hazards.filter((x) => x.caseId !== h.caseId), { ...h, at: Date.now() }] }));
}

/** Hazards nobody has acknowledged yet in this browser. */
export const openHazards = (w: World) => w.hazards.filter((h) => !w.acks.some((a) => a.caseId === h.caseId && a.at >= h.at));

export function patchCase(id: string, patch: Partial<CaseEntry>) {
  update((w) => ({ ...w, cases: w.cases.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
}

export function markAnswered(id: string, test: TestId, by: Answerer, from: "here" | "phone") {
  update((w) => ({
    ...w,
    cases: w.cases.map((c) => (c.id === id ? { ...c, answered: { ...c.answered, [test]: { by, from, at: Date.now() } } } : c)),
  }));
}

export function saveRun(caseId: string, run: AgentRun, note: string) {
  update((w) => ({ ...w, runs: { ...w.runs, [caseId]: { run, note } } }));
}

export function nextWorkOrderId(w: World) {
  return `WO-${String(w.workOrders.length + 1).padStart(4, "0")}`;
}

export function upsertWorkOrder(o: WorkOrder) {
  update((w) => ({ ...w, workOrders: [...w.workOrders.filter((x) => x.id !== o.id), o] }));
}

export function acknowledge(caseId: string, by: string) {
  update((w) => ({ ...w, acks: [...w.acks.filter((a) => a.caseId !== caseId), { caseId, by, at: Date.now() }] }));
}

export function markSeen(key: string) {
  if (world.seen[key]) return;
  update((w) => ({ ...w, seen: { ...w.seen, [key]: true } }));
}

export const caseEntry = (w: World, id: string) => w.cases.find((c) => c.id === id);
