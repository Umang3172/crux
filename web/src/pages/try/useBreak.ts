// "Break it": feed the chosen fault to the pump model and open the case.
// The engine's own cases and the AI investigator's both start through the
// demo's launch helpers, which also record the case in this browser.

import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import type { FaultKind } from "../../api/types";
import { openAiCase, openEngineCase, type CaseParams } from "../../demo/launch";
import { isOffList, LISTED, PINNED_SEED, pick, randomSeed, type Setup } from "./options";

/** The investigator that will take the case: off-list faults leave no choice. */
export const investigatorFor = (s: Setup) => (isOffList(s.choice) ? "ai" : s.who);

export function useBreak() {
  const navigate = useNavigate();
  const [state, setState] = useState<{ busy: boolean; error: unknown }>({ busy: false, error: null });

  const run = useCallback(
    async (setup: Setup) => {
      setState({ busy: true, error: null });
      try {
        // A hidden case picks one of the five faults now, and keeps it from the visitor.
        const hidden = setup.choice === "hidden";
        const kind = setup.choice === "hidden" ? pick(LISTED) : setup.choice;
        const params: CaseParams = {
          fault: kind,
          severity: setup.severity,
          seed: setup.pinned ? PINNED_SEED : randomSeed(),
          extra_noise: setup.floor,
        };
        const id =
          investigatorFor(setup) === "ai"
            ? await openAiCase(params, { machine: "p2", hidden, note: setup.note.trim() || undefined })
            : await openEngineCase(params as CaseParams & { fault: FaultKind }, { machine: "p2", hidden });
        navigate(`/case/${id}`);
      } catch (e) {
        setState({ busy: false, error: e });
      }
    },
    [navigate],
  );

  return { ...state, run };
}
