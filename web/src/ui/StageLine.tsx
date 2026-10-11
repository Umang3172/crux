// The stage line: where a case or a work order is, as one ruled strip.
// Reached stages are buttons, so earlier steps stay one click away.

import { Icon } from "./Icon";
import s from "./StageLine.module.css";

export type Stage = { id: string; label: string };

export function StageLine({
  stages,
  reached,
  current,
  onSelect,
  label = "Stages",
}: {
  stages: Stage[];
  /** Index of the furthest stage reached. */
  reached: number;
  /** Index of the stage on screen. */
  current: number;
  onSelect?: (index: number) => void;
  label?: string;
}) {
  return (
    <nav className={s.line} aria-label={label}>
      <ol style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
        {stages.map((st, i) => {
          // Ticked only once passed; reachable stages ahead stay open circles you can click.
          const done = i < current;
          const state = i === current ? s.current : done ? s.done : i <= reached ? s.open : s.ahead;
          const content = (
            <>
              <span className={s.mark}>{i === current ? <Icon name="dot" size={16} /> : done ? <Icon name="check" size={16} /> : <Icon name="circle" size={14} />}</span>
              <span className={s.label}>{st.label}</span>
            </>
          );
          return (
            <li key={st.id} className={state} aria-current={i === current ? "step" : undefined}>
              {onSelect && i <= reached && i !== current ? (
                <button type="button" onClick={() => onSelect(i)}>
                  {content}
                </button>
              ) : (
                <span className={s.static}>{content}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
