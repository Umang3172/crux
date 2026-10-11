// "Next planned stop in N hours": the chance the part reaches the danger line
// before that stop, as the server works it out from the current forecast. The
// server's own note rides along, because this is a planning aid.

import { useEffect, useState } from "react";
import { risk } from "../../api/crux";
import type { Risk } from "../../api/types";
import { pct } from "../../lib/format";
import s from "./RiskInput.module.css";

export function RiskInput({
  machine,
  part,
  at,
  value,
  onChange,
}: {
  machine: string;
  part: string;
  /** The running hour of the forecast in force; null before the alarm. */
  at: number | null;
  value: string;
  onChange: (v: string) => void;
}) {
  const stop = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(stop) && stop >= 0;
  const [result, setResult] = useState<Risk | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (at === null || !valid) {
      setResult(null);
      setFailed(null);
      return;
    }
    let live = true;
    // A short wait, so typing "12" does not ask the server about "1" first.
    const timer = window.setTimeout(() => {
      risk(machine, part, at, stop)
        .then((r) => {
          if (!live) return;
          setResult(r);
          setFailed(null);
        })
        .catch((e: unknown) => live && setFailed(e instanceof Error ? e.message : "The risk could not be worked out."));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [machine, part, at, stop, valid]);

  return (
    <div className={s.risk}>
      <label className={s.ask} htmlFor="stop-in">
        <span>Next planned stop in</span>
        <input id="stop-in" className={s.input} type="number" inputMode="decimal" min={0} step={0.5} value={value} onChange={(e) => onChange(e.target.value)} />
        <span>hours</span>
      </label>
      {at === null ? (
        <p className={s.line}>No forecast yet: the alarm has not fired.</p>
      ) : !valid ? (
        <p className={s.line}>Enter the hours until the next planned stop.</p>
      ) : failed ? (
        <p className={s.line} role="alert">
          {failed}
        </p>
      ) : result?.risk != null ? (
        <p className={s.line}>
          <strong className={s.figure}>{pct(result.risk)}</strong> chance it reaches the danger line before the stop.
          <span className={s.note}>{result.note}</span>
        </p>
      ) : result ? (
        <p className={s.line}>{result.note}</p>
      ) : (
        <p className={s.line}>Working it out…</p>
      )}
    </div>
  );
}
