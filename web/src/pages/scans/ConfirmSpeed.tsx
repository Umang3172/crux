// The physics needs the shaft speed from a person. The clip's strongest motion
// lines are offered as suggestions, read as one turn per cycle, but nothing is
// filled in until someone picks one or types the speed: a model's reading of a
// nameplate is never used as a number.

import { useId, useState } from "react";
import { analyseScan } from "../../api/crux";
import type { Box, Scan, ScanAnalysis } from "../../api/types";
import { Button } from "../../ui/Button";
import { hz, lensFailure } from "./words";
import s from "./ConfirmSpeed.module.css";

export function ConfirmSpeed({ scan, box, onAnalysed }: { scan: Scan; box: Box; onAnalysed: (a: ScanAnalysis) => void }) {
  const id = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const speed = Number(text);
  const valid = text.trim() !== "" && Number.isFinite(speed) && speed > 0 && speed <= 60000;

  async function analyse(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      onAnalysed(await analyseScan(scan.id, { rpm: speed, box }));
    } catch (err) {
      setError(lensFailure(err, "The physics could not run on this clip."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={s.form} onSubmit={analyse}>
      <div className={s.field}>
        <label className={s.label} htmlFor={id}>
          Shaft speed, in turns a minute
        </label>
        <input
          id={id}
          className={s.input}
          type="number"
          inputMode="decimal"
          min={1}
          max={60000}
          step="any"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="From the nameplate or the machine's display"
          aria-describedby={`${id}-hint`}
        />
        <p id={`${id}-hint`} className={s.hint}>
          A person confirms this, because every line the physics checks is a multiple of it.
        </p>
      </div>

      {scan.candidates.length > 0 && (
        <div className={s.field}>
          <p className={s.label}>Or pick what the clip suggests</p>
          <div className={s.suggest}>
            {scan.candidates.map((c) => (
              <button key={c.hz} type="button" className={s.pick} onClick={() => setText(String(Math.round(c.rpm_if_1x)))}>
                <span className={s.rpm}>{Math.round(c.rpm_if_1x).toLocaleString("en-GB")} rpm</span>
                <span className={s.where}>if the line at {hz(c.hz)} is one turn</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" kind="primary" size="l" busy={busy} disabled={!valid || busy} className={s.go}>
          {busy ? "Reading the motion…" : "Run the physics"}
        </Button>
      </div>
      {text.trim() !== "" && !valid && <p className={s.hint}>Enter a speed between 1 and 60,000 turns a minute.</p>}
    </form>
  );
}
