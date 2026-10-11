// A test with several bearings on one shaft: pick the one to read. Each shows
// its own health at the clock, and a flagged one says so.

import type { PartNow } from "./replay";
import s from "./PartPicker.module.css";

export function PartPicker({ parts, focusId, onPick }: { parts: PartNow[]; focusId: string; onPick: (id: string) => void }) {
  if (parts.length < 2) return null;
  return (
    <div className={s.picker} role="group" aria-label="Bearing to look at">
      {parts.map((p) => (
        <button key={p.part.part} type="button" className={s.part} aria-pressed={p.part.part === focusId} onClick={() => onPick(p.part.part)}>
          <span className={s.name}>{p.part.label}</span>
          <span className={s.pct}>{Math.round(p.percent)}%</span>
          {p.alarmed && <span className={s.flag}>Alarm</span>}
        </button>
      ))}
    </div>
  );
}
