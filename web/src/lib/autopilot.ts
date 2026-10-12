// The autonomous run: a fixed set of synthetic faults sent to the agents one
// after another, with nobody answering. It lives outside any page so it keeps
// going while the visitor moves around the console.
//
// A run on the offline stand-in is over in a fraction of a second, so each one
// is held on screen for as long as its calls take to show. "Skip" drops the
// wait; it never changes what was run.

import { useSyncExternalStore } from "react";
import type { RunParams } from "../api/types";
import { launchAgents } from "./launch";
import { getLiveRun, shownSteps } from "./liveruns";
import { quickDuration } from "./playback";
import { FAULT_SET } from "./scenarios";

export type BatchItem = {
  params: RunParams;
  /** running: the agents have it. showing: it has finished and its calls are still being shown. */
  state: "queued" | "running" | "showing" | "done" | "failed";
  caseId?: string;
  error?: string;
};

export type Batch = { id: string; items: BatchItem[]; running: boolean; skip: boolean; startedAt: number; finishedAt?: number };

let batch: Batch | null = null;
let wake: (() => void) | null = null;
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

const hold = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = window.setTimeout(done, ms);
    function done() {
      window.clearTimeout(t);
      wake = null;
      resolve();
    }
    wake = done;
  });

export async function startBatch(set: RunParams[] = FAULT_SET) {
  if (batch?.running) return;
  const id = `run-${Date.now().toString(36)}`;
  batch = { id, items: set.map((params) => ({ params, state: "queued" })), running: true, skip: false, startedAt: Date.now() };
  emit();
  for (let i = 0; i < set.length; i++) {
    setItem(i, { state: "running" });
    try {
      const { opened, finished } = launchAgents(set[i], { batch: id, watch: false });
      opened.then((caseId) => setItem(i, { caseId })).catch(() => undefined);
      const caseId = await finished;
      if (!batch?.skip) {
        setItem(i, { state: "showing", caseId });
        await hold(quickDuration(shownSteps(getLiveRun(caseId)?.steps ?? [])) + 420);
      }
      setItem(i, { state: "done", caseId });
    } catch (e) {
      setItem(i, { state: "failed", error: (e as Error).message });
    }
  }
  batch = { ...batch, running: false, finishedAt: Date.now() };
  emit();
}

/** Stop holding each run on screen; the runs still to come are still run. */
export function skipBatchAnimation() {
  if (!batch) return;
  batch = { ...batch, skip: true };
  emit();
  wake?.();
}

export function clearBatch() {
  if (batch?.running) return;
  batch = null;
  emit();
}
