// Which recording to replay. The names carry the test and the run, never how
// it ended.

import type { MachineSummary } from "../../api/types";
import s from "./RunPicker.module.css";

/** Recordings grouped by the test they come from, in the order the server lists them. */
function grouped(list: MachineSummary[]): [string, MachineSummary[]][] {
  const out = new Map<string, MachineSummary[]>();
  for (const m of list) {
    const key = m.source.split(" (")[0];
    out.set(key, [...(out.get(key) ?? []), m]);
  }
  return [...out.entries()];
}

export function RunPicker({ list, value, onPick }: { list: MachineSummary[]; value: string; onPick: (id: string) => void }) {
  if (list.length < 2) return null;
  return (
    <label className={s.pick}>
      <span className={s.label}>Recording</span>
      <select className={s.select} value={value} onChange={(e) => onPick(e.target.value)}>
        {grouped(list).map(([group, rows]) => (
          <optgroup key={group} label={group}>
            {rows.map((m) => (
              <option key={m.machine} value={m.machine}>
                {m.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
