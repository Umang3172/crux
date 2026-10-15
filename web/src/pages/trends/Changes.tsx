// What changed against the normal week, as BigQuery's contribution analysis
// ranks it: the stretches of time that moved the loaded share while running most.

import type { ChangesView } from "../../api/series.types";
import { MadeLine } from "./Made";

const pc = (x: number | null) => (x === null ? "–" : `${x.toFixed(1)}%`);
const SHOWN = 4;

export function Changes({ view }: { view: ChangesView }) {
  const rows = view.rows.slice(0, SHOWN);
  const top = Math.max(1e-9, ...rows.map((r) => Math.abs(r.attribution ?? 0)));
  return (
    <div className="tn-changed-body">
      <div className="tn-versus">
        <span className="tn-versus-num">{pc(view.overall.test)}</span>
        <span className="muted">
          loaded while running, against <b className="tn-ink">{pc(view.overall.control)}</b> in the normal week
        </span>
      </div>
      <p className="muted small tn-versus-what">Of the minutes the motor ran, the share it ran loaded. A leak makes it work harder to hold the pressure.</p>
      {rows.length === 0 ? (
        <p className="muted">No stretch of time changed enough to rank.</p>
      ) : (
        <ol className="tn-changes" aria-label="Where it changed most, largest first">
          {rows.map((r) => {
            const a = r.attribution ?? 0;
            return (
              <li key={r.contributors.join("|")}>
                <div className="tn-change-head">
                  <b>{r.label}</b>
                  <span className="mono small">
                    {pc(r.test)} <span className="muted">vs {pc(r.control)}</span>
                  </span>
                </div>
                <div className="tn-change-bar" aria-hidden>
                  <span className={a >= 0 ? "up" : "down"} style={{ width: `${(Math.abs(a) / top) * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <MadeLine made={view.made} what="BigQuery ML contribution analysis; a bar is that stretch's share of the change" />
    </div>
  );
}
