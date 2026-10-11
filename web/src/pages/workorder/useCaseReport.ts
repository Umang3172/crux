// The case's report, in two goes. The engine's own lines come back at once and
// are enough to plan from. The version with a language model's plain words can
// take half a minute, so it fills in when it lands and never holds the plan up.

import { useCallback, useEffect, useState } from "react";
import { report } from "../../api/crux";
import type { Report } from "../../api/types";
import { once } from "./once";

type State = { engine: Report | null; full: Report | null; engineError: Error | null; fullError: Error | null; pending: boolean };

const EMPTY: State = { engine: null, full: null, engineError: null, fullError: null, pending: true };

export function useCaseReport(caseId: string | undefined, enabled: boolean) {
  const [state, setState] = useState<State>(EMPTY);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!caseId || !enabled) return;
    let live = true;
    setState(EMPTY);
    once(`${caseId}|engine`, () => report(caseId, "engine"))
      .then((engine) => live && setState((s) => ({ ...s, engine })))
      .catch((e: Error) => live && setState((s) => ({ ...s, engineError: e })));
    once(`${caseId}|`, () => report(caseId))
      .then((full) => live && setState((s) => ({ ...s, full, pending: false })))
      .catch((e: Error) => live && setState((s) => ({ ...s, fullError: e, pending: false })));
    return () => {
      live = false;
    };
  }, [caseId, enabled, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, report: state.full ?? state.engine, reload };
}
