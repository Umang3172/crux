// The autonomous run: a fixed set of synthetic faults sent to the agents one
// after another, with nobody answering. It lives outside any page so it keeps
// going while the visitor moves around the console.

import { useSyncExternalStore } from "react";
import type { RunParams } from "../api/types";
import { openAgentsCase } from "./launch";
import { FAULT_SET } from "./scenarios";

export type BatchItem = {
  params: RunParams;
  state: "queued" | "running" | "done" | "failed";
  caseId?: string;
  error?: string;
};

export type Batch = { id: string; items: BatchItem[]; running: boolean; startedAt: number; finishedAt?: number };

let batch: Batch | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useBatch = () => useSyncExternalStore(subscribe, () => batch, () => batch);

function setItem(i: number, patch: Partial<BatchItem>) {
  if (!batch) return;
  batch = { ...batch, items: batch.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) };
  emit();
}

export async function startBatch(set: RunParams[] = FAULT_SET) {
  if (batch?.running) return;
  const id = `run-${Date.now().toString(36)}`;
  batch = { id, items: set.map((params) => ({ params, state: "queued" })), running: true, startedAt: Date.now() };
  emit();
  for (let i = 0; i < set.length; i++) {
    setItem(i, { state: "running" });
    try {
      const caseId = await openAgentsCase(set[i], { batch: id });
      setItem(i, { state: "done", caseId });
    } catch (e) {
      setItem(i, { state: "failed", error: (e as Error).message });
    }
  }
  batch = { ...batch, running: false, finishedAt: Date.now() };
  emit();
}

export function clearBatch() {
  if (batch?.running) return;
  batch = null;
  emit();
}
