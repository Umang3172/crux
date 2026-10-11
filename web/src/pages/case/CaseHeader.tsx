import type { Investigation } from "../../api/types";
import type { CaseEntry } from "../../demo/world";
import { num, rpm, shortId, times } from "../../lib/format";
import { Button } from "../../ui/Button";
import { SourceTag } from "../../ui/SourceTag";
import type { Readings } from "./model";
import s from "./Case.module.css";

export function CaseHeader({
  inv,
  entry,
  read,
  machineName,
  evidence,
  onEvidence,
  onLog,
}: {
  inv: Investigation;
  entry: CaseEntry | undefined;
  read: Readings;
  machineName: string;
  evidence: boolean;
  onEvidence: (v: boolean) => void;
  onLog: () => void;
}) {
  return (
    <header className={s.head}>
      <div className={s.ident}>
        <div className={s.titleRow}>
          <h1 className={s.title}>{machineName}</h1>
          <span className={s.caseNo}>Case {shortId(inv.id)}</span>
          <SourceTag>physics model · synthetic</SourceTag>
        </div>
        <p className={s.who}>
          Investigated by Crux's engine; a person answers any check.
          {entry?.story ? " Opened from the demo guide." : entry?.hidden ? " The fault was fed in and hidden from you." : ""}
        </p>
        <div className={s.tools}>
          <label className={s.switch}>
            <input type="checkbox" checked={evidence} onChange={(e) => onEvidence(e.target.checked)} />
            Open all evidence
          </label>
          <Button kind="quiet" onClick={onLog}>
            Evidence log ({inv.ledger.length})
          </Button>
        </div>
      </div>
      <dl className={s.readouts} aria-label="The reading">
        <div className={s.readout}>
          <dt className={s.readoutLabel}>Vibration</dt>
          <dd className={s.readoutValue}>{read.level === null ? "–" : `${times(read.level)} normal`}</dd>
          {read.noisyFloor && read.level !== null && <dd className={s.readoutNote}>a healthy pump on this noisy floor reads about the same</dd>}
        </div>
        <div className={s.readout}>
          <dt className={s.readoutLabel}>Bearing</dt>
          <dd className={s.readoutValue}>{read.temperatureC === null ? "–" : `${num(read.temperatureC, 1)} °C`}</dd>
        </div>
        <div className={s.readout}>
          <dt className={s.readoutLabel}>Speed</dt>
          <dd className={s.readoutValue}>{read.rpm === null ? "–" : rpm(read.rpm)}</dd>
          <dd className={s.readoutNote}>measured from the signal</dd>
        </div>
      </dl>
    </header>
  );
}
