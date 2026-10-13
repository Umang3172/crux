// Where a machine is along its own workflow: a thin rail with the current step
// marked, the step's name, and whose turn it is. The mark glides to the next
// step when the machine moves on.

import type { CSSProperties } from "react";
import { OWNER, WORKFLOW, type MachineStatus, type PlantMachine } from "../../lib/plant";
import { cx } from "../../ui/kit";

export function Flow({ m, st, who = true }: { m: PlantMachine; st: MachineStatus; who?: boolean }) {
  const steps = WORKFLOW[m.mode];
  const at = Math.min(st.step, steps.length - 1);
  const tone = st.busy ? "accent" : st.tone;
  return (
    <div className="flow-wrap">
      <div
        className={cx("flow", `tone-${tone}`, at < 0 && "idle")}
        style={{ "--n": steps.length, "--at": Math.max(0, at) } as CSSProperties}
        role="img"
        aria-label={at >= 0 ? `Step ${at + 1} of ${steps.length}: ${steps[at]}` : "Not started"}
      >
        {steps.map((s, i) => (
          <span key={s} className={i < at ? "done" : undefined} />
        ))}
        <i className="flow-now" aria-hidden />
      </div>
      <div className="flow-label">
        <b>{at >= 0 ? steps[at] : "Not started"}</b>
        {who && st.owner && <span className={cx("owner", st.owner)}>{OWNER[st.owner]}</span>}
      </div>
    </div>
  );
}
