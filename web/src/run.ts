/**
 * Drive one investigation and cut it into the steps the view plays back.
 *
 * Every step renders a state the engine actually returned. Nothing here
 * interpolates a belief or invents an intermediate number: to get the
 * trajectory rather than just the verdict we *walk the real endpoints*.
 *
 *   1. POST /replay          — the rig answers every request; gives us the
 *                              measured values the oracle produced.
 *   2. POST /investigations  — the same capture, stopped at the first request.
 *   3. POST .../evidence     — feed back the values from (1), one at a time.
 *
 * Steps 2 and 3 are the same computation the replay did, paused between rounds,
 * so the belief bars move through states the engine computed rather than states
 * the UI guessed at. If any of it fails we fall back to showing the replay
 * result on its own, which is still a complete, honest case.
 */

import {
  Investigation,
  RunParams,
  replay as postReplay,
  startInvestigation,
  submitEvidence,
} from "./api";

export type Phase = "observe" | "experiments" | "request" | "measurement" | "conclusion";

export type Step = {
  key: string;
  phase: Phase;
  title: string;
  /** The engine state to render at this point. Always an API response. */
  inv: Investigation;
  /** Ledger entries in existence at this point; the rest have not happened. */
  ledgerUpTo: number;
  /** Narration lines spoken by this point. */
  transcriptUpTo: number;
  /** Before any experiment has run the belief is the engine's uniform prior. */
  prior: boolean;
  /** Which requested measurement this step is about, if any. */
  requestIndex: number | null;
  /** True once that request has been answered and the value is in the ledger. */
  answered: boolean;
};

const PHASE_TITLES: Record<Phase, string> = {
  observe: "observe",
  experiments: "virtual experiments",
  request: "asks a human",
  measurement: "evidence returns",
  conclusion: "conclusion",
};

function step(
  phase: Phase,
  inv: Investigation,
  ledgerUpTo: number,
  opts: {
    prior?: boolean;
    requestIndex?: number | null;
    answered?: boolean;
    transcriptUpTo?: number;
    key: string;
  },
): Step {
  return {
    key: opts.key,
    phase,
    title: PHASE_TITLES[phase],
    inv,
    ledgerUpTo,
    transcriptUpTo: opts.transcriptUpTo ?? inv.transcript.length,
    prior: opts.prior ?? false,
    requestIndex: opts.requestIndex ?? null,
    answered: opts.answered ?? false,
  };
}

/**
 * Where the narration stops being about the capture and starts being about the
 * request. Counting lines would be wrong: the engine also narrates every
 * hypothesis it rejects, and how many it rejects depends on the case.
 */
function firstRequestLine(inv: Investigation): number {
  const i = inv.transcript.findIndex((line) => line.includes("Requesting:"));
  return i === -1 ? inv.transcript.length : i;
}

/** Index of the first virtual-experiment entry: everything before it is observation. */
function firstExperiment(inv: Investigation): number {
  const i = inv.ledger.findIndex((e) => e.source === "virtual_experiment");
  return i === -1 ? inv.ledger.length : i;
}

/** Index just past the last virtual-experiment entry. */
function pastExperiments(inv: Investigation): number {
  let i = inv.ledger.length;
  while (i > 0 && inv.ledger[i - 1].source !== "virtual_experiment") i -= 1;
  return i;
}

/**
 * Cut a chain of engine states into steps.
 *
 * `states[0]` is the opened investigation; each later entry is the state after
 * one measurement was handed back.
 */
export function toSteps(states: Investigation[]): Step[] {
  const steps: Step[] = [];
  const head = states[0];
  if (!head) return steps;

  const observed = firstExperiment(head);
  steps.push(step("observe", head, observed, { prior: true, transcriptUpTo: 1, key: "observe" }));

  const experimented = pastExperiments(head);
  if (experimented > observed) {
    steps.push(
      step("experiments", head, experimented, {
        transcriptUpTo: firstRequestLine(head),
        key: "experiments",
      }),
    );
  }
  if (head.ledger.length > experimented) {
    steps.push(step("request", head, head.ledger.length, { requestIndex: 0, key: "request-0" }));
  }

  states.slice(1).forEach((inv, round) => {
    const previous = states[round];
    const measured = inv.ledger.findIndex(
      (e, i) => i >= previous.ledger.length && e.source === "human_measurement",
    );
    const upTo = measured === -1 ? inv.ledger.length : measured + 1;
    // The request card stays on screen through this beat, now showing what came
    // back: "asked for this, paid two minutes, got 0.52" is the whole argument.
    steps.push(
      step("measurement", inv, upTo, {
        requestIndex: round,
        answered: true,
        key: `measurement-${round}`,
      }),
    );

    if (inv.conclusion) {
      steps.push(step("conclusion", inv, inv.ledger.length, { key: `conclusion-${round}` }));
    } else if (inv.ledger.length > upTo) {
      steps.push(
        step("request", inv, inv.ledger.length, {
          requestIndex: round + 1,
          key: `request-${round + 1}`,
        }),
      );
    }
  });

  return steps;
}

/** Run a case and return it as a playable list of steps. */
export async function investigate(params: RunParams): Promise<Step[]> {
  const settled = await postReplay(params);

  try {
    const states: Investigation[] = [await startInvestigation(params)];
    for (const outcome of settled.outcomes) {
      const current = states[states.length - 1];
      if (current.conclusion) break;
      states.push(await submitEvidence(current.id, outcome.test_id, outcome.value));
    }
    const steps = toSteps(states);
    const last = states[states.length - 1];
    if (last.conclusion) return steps;
    // The stepped run stopped short of a verdict (no measurement was needed, or
    // a round was refused). Close on the replay, which always concludes.
    return [...steps, step("conclusion", settled, settled.ledger.length, { key: "conclusion" })];
  } catch {
    return toSteps([settled]).concat(
      step("conclusion", settled, settled.ledger.length, { key: "conclusion" }),
    );
  }
}
