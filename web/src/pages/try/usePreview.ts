// What the pump model's sensor would read at the chosen settings, so the
// pump on this page shakes with a measured number and not an invented one.
// Only the server's /capture can measure it, and only for faults on the
// list; for anything else the pump is drawn still.

import { useEffect, useState } from "react";
import { capture } from "../../api/crux";
import { isOffList, PINNED_SEED, type FaultChoice } from "./options";

export type Preview =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "off-list" }
  | { kind: "unavailable" }
  /** `level` and `healthy` are multiples of a healthy pump in a quiet room. */
  | { kind: "ready"; level: number; healthy: number };

export function usePreview(choice: FaultChoice, severity: number, floor: number): Preview {
  const [state, setState] = useState<Preview>({ kind: "loading" });

  useEffect(() => {
    if (choice === "hidden") return setState({ kind: "hidden" });
    if (isOffList(choice)) return setState({ kind: "off-list" });

    let live = true;
    // Wait out a quick run of clicks; the previous reading stays until the next one lands.
    const timer = window.setTimeout(async () => {
      try {
        const run = { severity, seed: PINNED_SEED, extra_noise: floor };
        const [mine, healthy] = await Promise.all([
          capture({ ...run, fault: choice }),
          choice === "healthy" ? Promise.resolve(null) : capture({ ...run, fault: "healthy" }),
        ]);
        if (!live) return;
        const same = healthy ?? mine;
        if (!mine || !same || mine.baseline_rms <= 0 || same.baseline_rms <= 0) return setState({ kind: "unavailable" });
        setState({ kind: "ready", level: mine.rms / mine.baseline_rms, healthy: same.rms / same.baseline_rms });
      } catch {
        if (live) setState({ kind: "unavailable" });
      }
    }, 160);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [choice, severity, floor]);

  return state;
}
