// The lines the repaired fault makes, before the repair and after it, against a
// healthy machine. Each is a peak in multiples of the floor around it, so 1 means
// it is not there; the scale is logarithmic because one line can be 40 times its
// floor while another is 2. On the first look the bars shrink from before to after.

import { motion } from "motion/react";
import type { RepairResult } from "../../api/types";
import { times } from "../../lib/format";
import { Counted } from "./Counted";
import c from "./LineBars.module.css";

type Row = RepairResult["lines"][number];

const label = (line: string) => line.replace(/^(\d+(?:\.\d+)?)x /, "$1× ");

export function LineBars({ rows, play }: { rows: Row[]; play: boolean }) {
  const peak = Math.max(10, ...rows.flatMap((r) => [r.before, r.after, r.usual ?? 1]));
  const span = Math.pow(10, Math.ceil(Math.log10(peak) * 2) / 2);
  const at = (v: number) => `${(Math.log10(Math.max(v, 1)) / Math.log10(span)) * 100}%`;
  const ticks = [1, 10, 100, 1000].filter((t) => t <= span);

  return (
    <div className={c.chart}>
      <p className={c.legend}>
        <span className={c.keyBefore}>Before the repair</span>
        <span className={c.keyAfter}>After</span>
        <span className={c.keyHealthy}>A healthy pump</span>
      </p>
      <ol className={c.rows}>
        <li className={c.axis} aria-hidden="true">
          {ticks.map((t) => (
            // A label at the far end hangs back from its tick, so it stays inside the panel.
            <span key={t} data-end={Math.log10(t) / Math.log10(span) > 0.85 || undefined} style={{ left: at(t) }}>
              {t}×
            </span>
          ))}
        </li>
        {rows.map((r) => (
          <li key={r.line} className={c.row}>
            <span className={c.name}>{label(r.line)}</span>
            <span className={c.track} aria-hidden="true">
              {ticks.map((t) => (
                <span key={t} className={c.grid} style={{ left: at(t) }} />
              ))}
              <span className={c.was} style={{ width: at(r.before) }} />
              <motion.span
                className={c.now}
                initial={play ? { width: at(r.before) } : false}
                animate={{ width: at(r.after) }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              />
              {r.usual !== null && <span className={c.usual} style={{ left: at(r.usual) }} />}
            </span>
            <span className={c.nums}>
              before {times(r.before)} · after <Counted from={r.before} value={r.after} play={play} format={times} />
              {r.usual !== null && <> · healthy {times(r.usual)}</>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
