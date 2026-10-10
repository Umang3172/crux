/**
 * After the answer: make the repair, capture the pump again, and check it.
 *
 * The capture after the repair is investigated from scratch, with the same
 * suspects and no memory of the first verdict (`investigation/repair.py`). So
 * the result is not "did the vibration drop by the amount we expected" but
 * whatever the engine concludes about the pump as it now runs: verified, still
 * there, something else, or not settled.
 *
 * On this page the pump is the demo's physics model, so the viewer chooses how
 * the repair went. Crux is not told which was chosen.
 */

import { useEffect, useState } from "react";
import { faultText, plainSentence } from "../guided/plain";
import { RepairCheck, RepairDone, RepairOutcome, checkRepair } from "./api";
import "./repair.css";

const HEADINGS: Record<RepairOutcome, string> = {
  verified: "Repair verified",
  still_there: "Not verified: the fault is still there",
  something_else: "That fault is gone, but something else shows",
  cause_gone: "That fault is gone. The rest is not settled",
  cannot_tell: "Not settled either way",
};

type Choice = { id: string; label: string; hint: string; done: RepairDone };

function choices(cause: string): Choice[] {
  // A repair can leave a fault of its own. Reassembly out of line is the usual one.
  const left = cause === "misalignment" ? "looseness" : "misalignment";
  return [
    { id: "good", label: "A good repair", hint: "The fault is fully removed.", done: { removed: 1 } },
    { id: "half", label: "Half a repair", hint: "Half of it is left.", done: { removed: 0.5 } },
    {
      id: "left",
      label: `Repaired, but ${left === "misalignment" ? "left out of line" : "left loose"}`,
      hint: `The fault is gone and the work left ${faultText(left).name.toLowerCase()}.`,
      done: { removed: 1, left_behind: left },
    },
  ];
}

const times = (x: number) => (x >= 100 ? x.toFixed(0) : x.toFixed(1));

export function RepairPanel({ id, cause }: { id: string; cause: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<Choice | null>(null);
  const [check, setCheck] = useState<RepairCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBusy(null);
    setPicked(null);
    setCheck(null);
    setError(null);
  }, [id]);

  const run = async (choice: Choice) => {
    setBusy(choice.id);
    setError(null);
    try {
      setCheck(await checkRepair(id, choice.done));
      setPicked(choice);
    } catch (e) {
      setCheck(null);
      setError(`The check could not run (${e instanceof Error ? e.message : String(e)}).`);
    } finally {
      setBusy(null);
    }
  };

  // The tallest bar in the table sets the scale for all of them.
  const top = check ? Math.max(...check.lines.flatMap((l) => [l.before, l.after]), 1) : 1;
  const width = (x: number) => `${Math.max(2, Math.round((Math.log10(Math.max(x, 1)) / Math.log10(top + 1)) * 100))}%`;

  return (
    <section className="p-repair" aria-label="After the repair">
      <h3>Now make the repair, and check it</h3>
      <p className="g-muted">
        Crux captures the pump again and investigates it from scratch, with every suspect back at
        even odds, asking for another check if one capture is not enough. Choose how the repair
        went. Crux is not told.
      </p>
      <div className="p-choices">
        {choices(cause).map((c) => (
          <button
            key={c.id}
            className={`g-option${picked?.id === c.id ? " on" : ""}`}
            onClick={() => void run(c)}
            disabled={busy !== null}
          >
            <b>{busy === c.id ? "Capturing again…" : c.label}</b>
            <span>{c.hint}</span>
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}

      {check && (
        <div className={`p-result ${check.outcome}`} aria-live="polite">
          <span className="p-kicker">After the repair</span>
          <b>{HEADINGS[check.outcome]}</b>
          <p>{plainSentence(check.statement)}</p>
          {check.limit && (
            <p className={check.limit_names_cause ? "p-limit stress" : "p-limit"}>
              {plainSentence(check.limit)}
              {check.limit_names_cause && " Check again on the next round to be sure."}
            </p>
          )}
          {check.caveat && <p className="p-limit">{check.caveat}</p>}
          {check.lines.length > 0 && (
            <table className="p-lines">
              <caption>
                The lines this fault makes, in multiples of the background around each. 1 means the
                line is not there.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Before</th>
                  <th scope="col">After</th>
                  <th scope="col">
                    {check.usual_from === "simulation" ? "Healthy (simulated)" : "Its own normal"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {check.lines.slice(0, 4).map((l) => (
                  <tr key={l.line}>
                    <th scope="row">{l.line}</th>
                    <td>
                      <i className="before" style={{ width: width(l.before) }} />
                      {times(l.before)}
                    </td>
                    <td>
                      <i className="after" style={{ width: width(l.after) }} />
                      {times(l.after)}
                    </td>
                    <td>{l.usual === null ? "–" : times(l.usual)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {check.rig && (
            <p className="g-muted p-fed">
              What the demo pump was given after the repair:{" "}
              <b>
                {check.rig.fault === "healthy"
                  ? "no fault"
                  : `${faultText(check.rig.fault).name.toLowerCase()} at ${Math.round(check.rig.severity * 100)}% strength`}
              </b>
              .
            </p>
          )}
        </div>
      )}
    </section>
  );
}
