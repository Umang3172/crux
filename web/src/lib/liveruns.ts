// Agent runs as they happen. The server streams each tool call and each answer;
// they are kept here, outside any page, so a run keeps arriving while the
// visitor moves around the console. Nothing here is stored: the finished run
// is what the session keeps.

import { useSyncExternalStore } from "react";
import type { AgentStep } from "../api/types";

export type LiveRun = {
  id: string;
  steps: AgentStep[];
  /** More steps may still arrive. */
  streaming: boolean;
  startedAt: number;
  finishedAt?: number;
  error?: string;
};

const runs = new Map<string, LiveRun>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function beginLive(id: string) {
  runs.set(id, { id, steps: [], streaming: true, startedAt: Date.now() });
  emit();
}

/** A step arrives twice: when the call is made, and again with the tools' answer. */
export function pushStep(id: string, index: number, step: AgentStep) {
  const run = runs.get(id);
  if (!run) return;
  const steps = [...run.steps];
  steps[index] = step;
  runs.set(id, { ...run, steps });
  emit();
}

export function endLive(id: string, error?: string) {
  const run = runs.get(id);
  if (!run) return;
  runs.set(id, { ...run, streaming: false, finishedAt: Date.now(), error });
  emit();
}

export const getLiveRun = (id: string | undefined) => (id ? runs.get(id) : undefined);
export const useLiveRun = (id: string | undefined) => useSyncExternalStore(subscribe, () => getLiveRun(id), () => getLiveRun(id));

/**
 * The run's opening step reads the case before any experiment has run and has
 * nothing true to report yet, so no screen shows it.
 */
export const isOpeningRead = (s: AgentStep | undefined, i: number) => i === 0 && s?.tool === "get_case";
export const shownSteps = (steps: AgentStep[]) => steps.filter((s, i) => s && !isOpeningRead(s, i));
