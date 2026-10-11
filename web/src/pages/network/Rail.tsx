// The four stops an update passes, hung on one rail like the suspects: the hub
// it comes from, this site's own test, the person who decides, and the model in
// use. The marker on the rail is the update itself; it exists only while an
// update is waiting or has just been installed, never as decoration.

import type { ReactNode } from "react";
import s from "./Rail.module.css";

export type Marker = { label: string; at: number; tone: "waiting" | "installed" | "failed" };

export function Rail({ stops, marker }: { stops: ReactNode[]; marker: Marker | null }) {
  return (
    <div className={s.rack}>
      <div className={s.rail} aria-hidden="true" />
      {marker && (
        <span
          className={[s.marker, s[marker.tone]].join(" ")}
          // The stops share the width equally with a fixed gap, so a stop's centre is (2n+1)/8 of the free width plus n gaps.
          style={{ left: `calc(${2 * marker.at + 1} * (100% - 3 * var(--gap)) / 8 + ${marker.at} * var(--gap))` }}
          aria-hidden="true"
        >
          {marker.label}
        </span>
      )}
      <ol className={s.stops}>
        {stops.map((stop, i) => (
          <li key={i} className={s.stop}>
            <span className={s.hook} aria-hidden="true" />
            {stop}
          </li>
        ))}
      </ol>
    </div>
  );
}
