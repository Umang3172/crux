// Taking the reading from the phone: the one press, what it sent, and what
// came of it. The press goes through `answerWithInstrument`, which reads the
// case again just before posting, so a reading another screen already sent
// is never scored twice.

import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ApiError, isWaking, onWaking } from "../../../api/client";
import type { Investigation, TestId } from "../../../api/types";
import { answerWithInstrument, openRequest, type InstrumentParams } from "../../../demo/instrument";

export type Phase =
  | { kind: "idle" }
  | { kind: "taking" }
  /** `before` is how many readings the case had when the press was made. `value` is null when another screen answered. */
  | { kind: "done"; test: TestId; before: number; value: number | null; already: boolean }
  | { kind: "failed"; message: string };

export function messageOf(e: unknown): string {
  if (e instanceof ApiError) {
    return e.status === 0 ? "The engine could not be reached. Check the connection, then press the button again." : e.detail;
  }
  return e instanceof Error ? e.message : "The reading was not sent. Press the button again.";
}

export function useTakeReading(
  caseId: string,
  params: InstrumentParams,
  inv: Investigation | null,
  setInv: Dispatch<SetStateAction<Investigation | null>>,
) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const take = useCallback(async () => {
    const request = inv ? openRequest(inv) : null;
    if (!inv || !request || phase.kind === "taking") return;
    const before = inv.outcomes.length;
    setPhase({ kind: "taking" });
    try {
      const res = await answerWithInstrument(caseId, params);
      setInv(res.inv);
      setPhase({ kind: "done", test: request.test_id, before, value: res.value ?? null, already: res.already });
    } catch (e) {
      setPhase({ kind: "failed", message: messageOf(e) });
    }
  }, [caseId, params, inv, phase.kind, setInv]);

  /** Back to the question, for the check Crux asked next. */
  const next = useCallback(() => setPhase({ kind: "idle" }), []);

  return { phase, take, next };
}

/** True while a request is slow enough that the engine is probably waking from sleep. */
export function useWaking(): boolean {
  const [waking, setWaking] = useState(isWaking());
  useEffect(() => onWaking(setWaking), []);
  return waking;
}
