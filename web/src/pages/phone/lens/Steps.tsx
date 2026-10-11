// Where the person is in the scan: three steps, the current one marked. The
// shared stage line holds five, so a phone page of three has its own strip.

import type { Stage } from "./useFlow";
import s from "./Lens.module.css";

const STEPS: { stage: Stage; label: string }[] = [
  { stage: "clip", label: "Clip" },
  { stage: "speed", label: "Speed" },
  { stage: "found", label: "Found" },
];

export function Steps({ stage }: { stage: Stage }) {
  const at = STEPS.findIndex((x) => x.stage === stage);
  return (
    <ol className={s.steps} aria-label="Steps">
      {STEPS.map((x, i) => (
        <li key={x.stage} className={i < at ? s.done : i === at ? s.now : s.ahead} aria-current={i === at ? "step" : undefined}>
          <span className={s.bar} aria-hidden="true" />
          <span className={s.stepLabel}>
            {i + 1} · {x.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
