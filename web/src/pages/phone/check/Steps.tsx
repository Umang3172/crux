// The check's steps, large enough to read on a bright floor, and the safety
// reminder that goes with any job near a turning shaft. The steps are the
// catalogue's own procedure; nothing is added to them.

import { Icon } from "../../../ui/Icon";
import s from "./Steps.module.css";

export function Steps({ steps }: { steps: string[] }) {
  return (
    <div className={s.wrap}>
      <ol className={s.steps} role="list">
        {steps.map((text, i) => (
          <li key={i} className={s.step}>
            <span className={s.n} aria-hidden="true">
              {i + 1}
            </span>
            <span className={s.text}>{text}</span>
          </li>
        ))}
      </ol>
      <p className={s.safety} role="note">
        <Icon name="hazard" size={24} />
        <span>
          <strong>Before you start.</strong> Keep hands, sleeves and cables clear of the shaft and coupling. If anything
          looks or smells unsafe, don't take the reading: make it safe and call your supervisor.
        </span>
      </p>
    </div>
  );
}
