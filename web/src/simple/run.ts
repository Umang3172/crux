// The two things a visitor can do on the simple view, done the console's way:
// send a machine its next demo reading (the same queue a shift uses), and take
// the one measurement the engine asked for with the pump model's instrument.

import { ApiError } from "../api/client";
import type { FaultKind, RunParams } from "../api/types";
import { answerWithInstrument } from "../lib/instrument";
import { launchAgents, openEngineCase } from "../lib/launch";
import { READINGS } from "../lib/scenarios";
import { getSession, markAnswered, patchCase, rememberInvestigation, type CaseEntry } from "../lib/session";

/** A run on the offline stand-in ends in a blink; hold it long enough to be seen. */
const SEEN_MS = 1800;
const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** The reading this machine sends next, in the order a shift would send it. */
function nextReading(machine: string) {
  const queue = READINGS[machine] ?? [];
  // A case the server forgot never happened as far as the queue is concerned.
  const sent = getSession().cases.filter((c) => (c.machine ?? "p2") === machine && c.batch && !c.lost).length;
  return queue.length ? queue[sent % queue.length] : null;
}

export async function investigateMachine(machine: string): Promise<string> {
  const reading = nextReading(machine);
  if (!reading) throw new Error("This machine has no demo reading to send.");
  const batch = `simple-${Date.now().toString(36)}`;
  const t0 = performance.now();
  let id: string;
  if (reading.by === "agents") {
    id = await launchAgents(reading.params, { machine, batch, watch: false }).finished;
  } else {
    id = await openEngineCase(reading.params, { machine, batch });
  }
  const left = SEEN_MS - (performance.now() - t0);
  if (left > 0) await wait(left);
  return id;
}

/** The pump model's instrument takes the reading; it answers from the fault it was given. */
export async function takeMeasurement(entry: CaseEntry, testId: string) {
  let r;
  try {
    r = await answerWithInstrument(entry.id, entry.params as RunParams & { fault: FaultKind });
  } catch (e) {
    // The server keeps cases in memory; after a restart this one is gone, and the page offers a fresh start.
    if (e instanceof ApiError && e.status === 404) return patchCase(entry.id, { lost: true });
    throw e;
  }
  rememberInvestigation(r.inv);
  if (!r.already && r.value !== undefined) markAnswered(entry.id, testId, "virtual instrument", "here", r.value);
}
