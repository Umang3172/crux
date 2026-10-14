// A shift at the plant: a reading comes in from every modelled machine at
// once and each is investigated, side by side. It lives outside any page so it
// keeps going while the visitor moves around the console.
//
// A run on the offline stand-in is over in a fraction of a second, so each one
// is held on screen for as long as its calls take to show. "Skip" drops the
// wait; it never changes what was run.

/** How fast the plant replays each run's calls: a little under the quick player's own pace, so a call can be read. */
export const SHOW_SPEED = 0.8;

import { useSyncExternalStore } from "react";
import { launchAgents, openEngineCase } from "./launch";
import { getLiveRun, shownSteps } from "./liveruns";
import { quickDuration } from "./playback";
import { MODELLED, statusOf, type Owner } from "./plant";
import { READINGS, type Reading } from "./scenarios";
import { getSession } from "./session";

export type ShiftItem = {
  machine: string;
  /** Nothing new from a machine that is waiting on a person. */
  reading: Reading | null;
  /** running: being investigated. showing: finished, its calls still on screen. held: no new reading. */
  state: "queued" | "running" | "showing" | "done" | "failed" | "held";
  /** Who a held machine is waiting on. */
  owner?: Owner;
  caseId?: string;
  error?: string;
};

export type Shift = { id: string; number: number; items: ShiftItem[]; running: boolean; skip: boolean; startedAt: number; finishedAt?: number };

let shift: Shift | null = null;
let count = 0;
const wakes = new Set<() => void>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const getShift = () => shift;
export const useShift = () => useSyncExternalStore(subscribe, () => shift, () => shift);

function setItem(i: number, patch: Partial<ShiftItem>) {
  if (!shift) return;
  shift = { ...shift, items: shift.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) };
  emit();
}

const hold = (ms: number) =>
  new Promise<void>((resolve) => {
    const done = () => {
      window.clearTimeout(t);
      wakes.delete(done);
      resolve();
    };
    const t = window.setTimeout(done, ms);
    wakes.add(done);
  });

async function work(i: number, machine: string, reading: Reading, id: string) {
  const item = { machine, ...reading };
  setItem(i, { state: "running" });
  try {
    let caseId: string;
    let steps = 0;
    if (item.by === "agents") {
      const { opened, finished } = launchAgents(item.params, { machine: item.machine, batch: id, watch: false });
      opened.then((c) => setItem(i, { caseId: c })).catch(() => undefined);
      caseId = await finished;
      steps = quickDuration(shownSteps(getLiveRun(caseId)?.steps ?? [])) / SHOW_SPEED;
    } else {
      caseId = await openEngineCase(item.params, { machine: item.machine, batch: id });
      steps = 900;
    }
    if (!shift?.skip) {
      setItem(i, { state: "showing", caseId });
      await hold(steps + 500);
    }
    setItem(i, { state: "done", caseId });
  } catch (e) {
    setItem(i, { state: "failed", error: (e as Error).message });
  }
}

/**
 * Start the next shift: a reading from every modelled machine that is free.
 * A machine with a measurement, a sign-off or a repair outstanding is held: it
 * would not be sending a fresh reading while people still owe it something.
 */
export async function startShift() {
  if (shift?.running) return;
  const cases = getSession().cases;
  count += 1;
  const id = `shift-${Date.now().toString(36)}`;
  const items: ShiftItem[] = MODELLED.map((m) => {
    const owner = statusOf(m, { cases }).owner;
    if (owner === "crew" || owner === "manager") return { machine: m.id, reading: null, state: "held", owner };
    const sent = cases.filter((c) => (c.machine ?? "p2") === m.id && c.batch).length;
    const queue = READINGS[m.id] ?? [];
    return { machine: m.id, reading: queue.length ? queue[sent % queue.length] : null, state: queue.length ? "queued" : "held" };
  });
  shift = { id, number: count, items, running: true, skip: false, startedAt: Date.now() };
  emit();
  await Promise.all(items.map((item, i) => (item.reading ? work(i, item.machine, item.reading, id) : Promise.resolve())));
  shift = { ...shift, running: false, finishedAt: Date.now() };
  emit();
}

/** Stop holding each run on screen; nothing that was to run is dropped. */
export function skipShiftAnimation() {
  if (!shift) return;
  shift = { ...shift, skip: true };
  emit();
  [...wakes].forEach((w) => w());
}

/** The machines being investigated, or shown, right now. */
export const busyMachines = (s: Shift | null) => new Set((s?.items ?? []).filter((i) => i.state === "running" || i.state === "showing").map((i) => i.machine));
