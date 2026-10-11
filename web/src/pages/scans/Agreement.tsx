// How well each fault's simulated motion matches what the camera measured.
// A bar is the physics' agreement score, 1 meaning the same pattern. Faults
// that are no longer possible stay on the list in grey: ruled out, not removed.

import { num } from "../../lib/format";
import s from "./Agreement.module.css";

export type Score = { kind: string; label: string; score: number };

export function Agreement({ scores, standing, label }: { scores: Score[]; standing: string[]; label: string }) {
  return (
    <ul className={s.list} aria-label={label}>
      {scores.map((a) => {
        const possible = standing.includes(a.kind);
        return (
          <li key={a.kind} className={possible ? s.possible : s.ruledOut}>
            <span className={s.name}>{a.label}</span>
            <span className={s.bar} aria-hidden="true">
              <span style={{ width: `${Math.max(0, Math.min(1, a.score)) * 100}%` }} />
            </span>
            <span className={s.value}>{num(a.score, 2)}</span>
          </li>
        );
      })}
    </ul>
  );
}
