/**
 * One suspect: a possible cause, its virtual copy, and how well that copy
 * matched the real reading.
 *
 * The mini chart is the virtual experiment itself (`/spectrum`): the real
 * reading in blue, this suspect's simulation in green. Shaft faults are drawn in
 * the raw spectrum and bearing faults in the envelope, because that is where
 * each family shows (docs/DECISIONS.md, ADR-0003).
 */

import { Hypothesis, Spectra } from "../api";
import { faultText, pct } from "./plain";

export type CardState = "waiting" | "testing" | "live" | "leading" | "ruled-out";

export const BEARING_FAULTS = new Set(["outer_race", "inner_race"]);

function sparkline(values: number[]): string {
  const peak = Math.max(...values) || 1;
  return values
    .map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(2)},${(38 - (v / peak) * 34).toFixed(2)}`)
    .join(" ");
}

export function SuspectCard({
  h,
  state,
  spectra,
}: {
  h: Hypothesis;
  state: CardState;
  spectra: Spectra | null;
}) {
  const text = faultText(h.kind);
  const tested = state !== "waiting" && state !== "testing";
  const chip: Record<CardState, string> = {
    waiting: "not tested yet",
    testing: "testing…",
    live: "still possible",
    leading: "most likely",
    "ruled-out": "ruled out",
  };

  return (
    <article className={`g-suspect ${state}`}>
      <header>
        <h3>{text.name}</h3>
        <span className={`g-chip ${state}`}>{chip[state]}</span>
      </header>

      <svg className="g-spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
        {spectra && tested ? (
          <>
            <polyline points={sparkline(spectra.real)} className="g-spark-real" />
            <polyline points={sparkline(spectra.simulated)} className="g-spark-sim" />
          </>
        ) : (
          <line x1="0" y1="38" x2="100" y2="38" className="g-spark-empty" />
        )}
      </svg>
      <p className="g-spark-cap">
        {tested
          ? `virtual copy vs real reading · ${BEARING_FAULTS.has(h.kind) ? "bearing view" : "vibration view"}`
          : "waiting for its virtual test"}
      </p>

      <div className="g-meter">
        <span>Match with the reading</span>
        <div className="g-bar">
          <i style={{ width: tested && h.correlation !== null ? pct(Math.max(0, h.correlation)) : "0%" }} />
        </div>
        <b>{tested && h.correlation !== null ? pct(Math.max(0, h.correlation)) : "–"}</b>
      </div>
      <div className="g-meter">
        <span>How likely now</span>
        <div className="g-bar likely">
          <i style={{ width: tested ? pct(h.posterior) : "0%" }} />
        </div>
        <b>{tested ? pct(h.posterior) : "–"}</b>
      </div>
    </article>
  );
}
