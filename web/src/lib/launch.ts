// Opening a case. Engine cases open on the server and stay there; an agent
// run comes back whole and is not stored by the server, so the run is kept in
// this browser's session.

import { agentReplay, startCase } from "../api/crux";
import type { FaultKind, RunParams } from "../api/types";
import { isOnList, type Scenario } from "./scenarios";
import { addCase, getSession } from "./session";

type Opts = { scenario?: string; batch?: string; note?: string; revealed?: boolean };

export async function openEngineCase(params: RunParams, opts: Opts = {}): Promise<string> {
  if (!isOnList(params.fault)) throw new Error("Only the agents can take a fault that is not on the engine's list.");
  const t0 = performance.now();
  const inv = await startCase({ ...params, fault: params.fault as FaultKind, plant: getSession().plant });
  addCase({
    id: inv.id,
    kind: "engine",
    params,
    revealed: !!opts.revealed,
    scenario: opts.scenario,
    batch: opts.batch,
    inv,
    tookMs: Math.round(performance.now() - t0),
  });
  return inv.id;
}

export async function openAgentsCase(params: RunParams, opts: Opts = {}): Promise<string> {
  const t0 = performance.now();
  const run = await agentReplay({ ...params, plant: getSession().plant, note: opts.note ?? "" });
  const id = run.case?.case_id;
  if (!id) throw new Error(run.stopped ?? "The agents did not open a case.");
  addCase({
    id,
    kind: "agents",
    params,
    revealed: !!opts.revealed,
    scenario: opts.scenario,
    batch: opts.batch,
    run,
    note: opts.note,
    tookMs: Math.round(performance.now() - t0),
  });
  return id;
}

export const launchScenario = (s: Scenario) =>
  s.investigator === "agents" ? openAgentsCase(s.params, { scenario: s.id }) : openEngineCase(s.params, { scenario: s.id });
