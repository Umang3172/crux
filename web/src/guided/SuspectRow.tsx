/**
 * One suspect in the line-up: a possible cause, its virtual copy against the
 * real reading, and how well it fits.
 *
 * The trace is the virtual experiment itself (`/spectrum`): the real reading in
 * ink, this suspect's simulation in coolant. Shaft faults are drawn in the raw
 * spectrum and bearing faults in the envelope, because that is where each family
 * shows (docs/DECISIONS.md, ADR-0003).
 */

import { Hypothesis, Spectra } from "../api";
import { faultText, pct } from "./plain";

export type RowState = "waiting" | "testing" | "live" | "leading" | "ruled-out" | "unseen";

export const BEARING_FAULTS = new Set(["outer_race", "inner_race"]);

const STATUS: Record<RowState, string> = {
  waiting: "Not tested yet",
  testing: "Testing",
  live: "Still possible",
  leading: "Most likely",
  "ruled-out": "Ruled out",
  unseen: "Not shown, but a mild one would look the same",
};

function trace(values: number[]): string {
  const peak = Math.max(...values) || 1;
  return values
    .map((v, i) => `${((i / (values.length - 1)) * 200).toFixed(1)},${(30 - (v / peak) * 27).toFixed(1)}`)
    .join(" ");
}

export function SuspectRow({
  h,
  state,
  spectra,
}: {
  h: Hypothesis;
  state: RowState;
  spectra: Spectra | null;
}) {
  const text = faultText(h.kind);
  const tested = state !== "waiting" && state !== "testing";
  const match = tested && h.correlation !== null ? Math.max(0, h.correlation) : null;

  return (
    <li className={`g-row ${state}`}>
      <div className="g-row-name">
        <h3>{text.name}</h3>
        <span className="g-row-status">{STATUS[state]}</span>
      </div>

      <figure className="g-row-trace">
        <svg viewBox="0 0 200 32" preserveAspectRatio="none" aria-hidden="true">
          {spectra && tested ? (
            <>
              <polyline points={trace(spectra.real)} className="real" />
              <polyline points={trace(spectra.simulated)} className="sim" />
            </>
          ) : (
            <line x1="0" y1="30" x2="200" y2="30" className="empty" />
          )}
        </svg>
        <figcaption>
          {tested ? (BEARING_FAULTS.has(h.kind) ? "Bearing view" : "Vibration view") : " "}
        </figcaption>
      </figure>

      <div className="g-row-meter">
        <span>Match</span>
        <div className="g-bar">
          <i style={{ width: match !== null ? pct(match) : "0%" }} />
        </div>
        <b>{match !== null ? pct(match) : "–"}</b>
      </div>

      <div className="g-row-meter likely">
        <span>Likelihood</span>
        <div className="g-bar">
          <i style={{ width: tested ? pct(h.posterior) : "0%" }} />
        </div>
        <b>{tested ? pct(h.posterior) : "–"}</b>
      </div>
    </li>
  );
}
