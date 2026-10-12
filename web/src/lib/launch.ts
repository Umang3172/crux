// Opening a case. Engine cases open on the server and stay there. An agent run
// is streamed while it happens and is not stored by the server, so the finished
// run is kept in this browser's session.

import { ApiError } from "../api/client";
import { agentReplay, agentStream, startCase } from "../api/crux";
import type { FaultKind, RunParams } from "../api/types";
import { machineById } from "./plant";
import { isOnList, type Scenario } from "./scenarios";
import { beginLive, endLive, pushStep } from "./liveruns";
import { addCase, getSession, patchCase } from "./session";

type Opts = { machine?: string; scenario?: string; batch?: string; note?: string; revealed?: boolean; watch?: boolean };

/** The server remembers closed cases per plant and machine; each machine here is its own entry. */
const plantKey = (machine: string) => `${getSession().plant}-${machine}`;
/** A modelled machine runs at its own speed. */
const onMachine = (params: RunParams, machine: string): RunParams => {
  const rpm = machineById(machine)?.rpm;
  return rpm ? { ...params, rpm } : params;
};

export async function openEngineCase(params: RunParams, opts: Opts = {}): Promise<string> {
  if (!isOnList(params.fault)) throw new Error("Only the agents can take a fault that is not on the engine's list.");
  const t0 = performance.now();
  const machine = opts.machine ?? "p2";
  params = onMachine(params, machine);
  const inv = await startCase({ ...params, fault: params.fault as FaultKind, plant: plantKey(machine) });
  addCase({
    id: inv.id,
    kind: "engine",
    machine,
    params,
    revealed: !!opts.revealed,
    scenario: opts.scenario,
    batch: opts.batch,
    inv,
    tookMs: Math.round(performance.now() - t0),
  });
  return inv.id;
}

/**
 * Send a case to the agents. `opened` resolves as soon as the case exists, so a
 * page can open on the run while it happens; `finished` resolves when the run
 * is over and stored. On a server with no stream route the finished run is
 * taken in one piece instead.
 */
export function launchAgents(params: RunParams, opts: Opts = {}): { opened: Promise<string>; finished: Promise<string> } {
  const t0 = performance.now();
  const machine = opts.machine ?? "p2";
  params = onMachine(params, machine);
  const body = { ...params, plant: plantKey(machine), note: opts.note ?? "" };
  const took = () => Math.round(performance.now() - t0);
  const entry = (id: string) => ({ id, kind: "agents" as const, machine, params, revealed: !!opts.revealed, scenario: opts.scenario, batch: opts.batch, note: opts.note, watch: opts.watch ?? true });
  let id: string | null = null;
  let resolveOpened!: (id: string) => void;
  let rejectOpened!: (e: Error) => void;
  const opened = new Promise<string>((resolve, reject) => {
    resolveOpened = resolve;
    rejectOpened = reject;
  });

  const finished = agentStream(body, {
    onOpen: (e) => {
      id = e.case_id;
      addCase(entry(id));
      beginLive(id);
      resolveOpened(id);
    },
    onStep: (index, step) => id && pushStep(id, index, step),
  })
    .then((run) => {
      const caseId = run.case?.case_id ?? id;
      if (!caseId) throw new Error(run.stopped ?? "The agents did not open a case.");
      patchCase(caseId, { run, tookMs: took() });
      endLive(caseId);
      return caseId;
    })
    .catch(async (e: Error) => {
      if (!id && e instanceof ApiError && (e.status === 404 || e.status === 405)) {
        const run = await agentReplay(body);
        const caseId = run.case?.case_id;
        if (!caseId) throw new Error(run.stopped ?? "The agents did not open a case.");
        addCase({ ...entry(caseId), run, tookMs: took() });
        beginLive(caseId);
        run.steps.forEach((step, index) => pushStep(caseId, index, step));
        endLive(caseId);
        resolveOpened(caseId);
        return caseId;
      }
      if (id) {
        endLive(id, e.message);
        patchCase(id, { failed: e.message });
      }
      throw e;
    });
  finished.catch(rejectOpened);
  return { opened, finished };
}

export const openAgentsCase = (params: RunParams, opts: Opts = {}): Promise<string> => launchAgents(params, opts).opened;

export const launchScenario = (s: Scenario) =>
  s.investigator === "agents" ? openAgentsCase(s.params, { scenario: s.id, machine: s.machine }) : openEngineCase(s.params, { scenario: s.id, machine: s.machine });
