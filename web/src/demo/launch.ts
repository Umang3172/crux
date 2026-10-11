// Starting a case from a story or from Try it. Engine cases open on the
// server and are recorded in this browser's world with their first state;
// AI runs come back whole, so the run is kept here too (the server returns it
// once and does not store it).

import { agentReplay, startCase } from "../api/crux";
import type { FaultKind, OffListFault, RunParams } from "../api/types";
import { addCase, getWorld, saveRun } from "./world";
import type { Story } from "./stories";

export type CaseParams = RunParams & { fault: FaultKind | OffListFault };

export async function openEngineCase(params: CaseParams & { fault: FaultKind }, opts: { machine?: string; story?: string; hidden?: boolean } = {}) {
  const inv = await startCase({ ...params, plant: getWorld().plant });
  addCase(
    { id: inv.id, kind: "engine", machine: opts.machine ?? "p2", story: opts.story, params, hidden: !!opts.hidden },
    inv,
  );
  return inv.id;
}

export async function openAiCase(params: CaseParams, opts: { machine?: string; story?: string; hidden?: boolean; note?: string } = {}) {
  const run = await agentReplay({ ...params, plant: getWorld().plant, note: opts.note ?? "" });
  const id = run.case?.case_id;
  if (!id) throw new Error(run.stopped ?? "The investigator did not open a case.");
  addCase({ id, kind: "ai", machine: opts.machine ?? "p2", story: opts.story, params, hidden: !!opts.hidden });
  saveRun(id, run, opts.note ?? "");
  return id;
}

/** Where a story starts. Returns the hash path to open. */
export async function launchStory(s: Story): Promise<string> {
  if (s.recording) return `/machine/${s.machine}?run=${encodeURIComponent(s.recording)}&story=${s.id}`;
  if (!s.params) return "/";
  if (s.investigator === "ai") {
    const id = await openAiCase(s.params, { machine: s.machine, story: s.id, note: s.note });
    return `/case/${id}`;
  }
  const id = await openEngineCase(s.params as CaseParams & { fault: FaultKind }, { machine: s.machine, story: s.id });
  return `/case/${id}`;
}
