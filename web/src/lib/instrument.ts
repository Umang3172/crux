// The pump model's virtual instrument. The demo pump is a physics model, so a
// "reading" of it is a new simulated capture of the same machine in the same
// state. The server can take that capture only inside /replay, which runs a
// whole case and answers every check itself; cases are deterministic, so the
// answer /replay gives at step k is the answer this case needs at step k.
// The phone reaches the same answer from the key in the QR link.

import { getCase, replay, submitEvidence } from "../api/crux";
import type { FaultKind, Investigation, RunParams, TestRequest } from "../api/types";

export type InstrumentParams = RunParams & { fault: FaultKind };

/** The request the case is still waiting on. `request` alone stays set after a verdict. */
export function openRequest(inv: Investigation): TestRequest | null {
  if (inv.outcome !== "open" || !inv.request) return null;
  const answered = inv.outcomes.filter((o) => o.test_id === inv.request!.test_id).length;
  const asked = inv.requested_tests.filter((t) => t === inv.request!.test_id).length;
  return answered < asked ? inv.request : null;
}

const cache = new Map<string, Promise<Investigation>>();
const keyOf = (p: InstrumentParams) => `${p.fault}|${p.severity}|${p.seed}|${p.extra_noise}`;

function instrumentRun(p: InstrumentParams): Promise<Investigation> {
  const k = keyOf(p);
  let run = cache.get(k);
  if (!run) {
    run = replay({ ...p, plant: "instrument", remember: false });
    run.catch(() => cache.delete(k));
    cache.set(k, run);
  }
  return run;
}

/** What the instrument reads for the case's open request. */
export async function instrumentReading(inv: Investigation, p: InstrumentParams): Promise<number> {
  const req = openRequest(inv);
  if (!req) throw new Error("This case is not waiting for a reading.");
  const run = await instrumentRun(p);
  const step = inv.outcomes.length;
  const answer = run.outcomes[step];
  if (!answer || answer.test_id !== req.test_id) {
    throw new Error("The pump model's run went a different way from this case, so it can't answer this check.");
  }
  return answer.value;
}

export type AnswerResult = { inv: Investigation; already: boolean; value?: number };

/**
 * Take the reading and hand it in, once. The evidence door scores a repeated
 * reading twice, so the case is read again just before posting and nothing is
 * sent when another device answered first.
 */
export async function answerWithInstrument(caseId: string, p: InstrumentParams): Promise<AnswerResult> {
  const before = await getCase(caseId);
  const req = openRequest(before);
  if (!req) return { inv: before, already: true };
  const value = await instrumentReading(before, p);
  const latest = await getCase(caseId);
  if (latest.outcomes.length !== before.outcomes.length || !openRequest(latest)) {
    return { inv: latest, already: true };
  }
  const inv = await submitEvidence(caseId, req.test_id, value, "virtual instrument");
  return { inv, already: false, value };
}

// The QR key: the case's run settings, short enough for a QR code. The pump
// model's instrument knows the fault it was given; the phone page says so.

export function encodeKey(p: InstrumentParams): string {
  const raw = JSON.stringify([p.fault, p.severity, p.seed, p.extra_noise]);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeKey(k: string): InstrumentParams | null {
  try {
    const pad = k.length % 4 ? "=".repeat(4 - (k.length % 4)) : "";
    const [fault, severity, seed, extra_noise] = JSON.parse(atob(k.replace(/-/g, "+").replace(/_/g, "/") + pad));
    if (typeof fault !== "string" || typeof severity !== "number") return null;
    return { fault: fault as FaultKind, severity, seed, extra_noise };
  } catch {
    return null;
  }
}
