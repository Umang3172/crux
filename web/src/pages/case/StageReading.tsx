import type { Capture, Investigation } from "../../api/types";
import type { CaseEntry } from "../../demo/world";
import { num, rpm, times } from "../../lib/format";
import { Button } from "../../ui/Button";
import { Section } from "../../ui/Section";
import { SourceTag } from "../../ui/SourceTag";
import type { Readings } from "./model";
import { Waveform } from "./Signals";
import s from "./Case.module.css";

export function StageReading({
  inv,
  entry,
  read,
  cap,
  evidence,
  onNext,
}: {
  inv: Investigation;
  entry: CaseEntry | undefined;
  read: Readings;
  cap: Capture | null;
  evidence: boolean;
  onNext: () => void;
}) {
  const trigger = entry?.hidden
    ? "A fault was fed into the pump model and hidden. Someone pressed Investigate."
    : "Someone pressed Investigate on the pump. Crux took a 2-second reading.";
  const signal = inv.ledger.filter((e) => e.source === "sensor" && !/reported|temperature/.test(e.statement));
  return (
    <div className={s.stage}>
      <h2 className={s.h2}>What Crux noticed</h2>
      <p className={s.lead}>{trigger}</p>
      <dl className={s.readouts} style={{ borderLeft: 0 }}>
        <div className={s.readout} style={{ paddingLeft: 0 }}>
          <dt className={s.readoutLabel}>Vibration</dt>
          <dd className={s.readoutValue}>{read.level === null ? "–" : `${times(read.level)} the quiet-room normal`}</dd>
        </div>
        <div className={s.readout}>
          <dt className={s.readoutLabel}>Bearing temperature</dt>
          <dd className={s.readoutValue}>{read.temperatureC === null ? "–" : `${num(read.temperatureC, 1)} °C`}</dd>
        </div>
        <div className={s.readout}>
          <dt className={s.readoutLabel}>Speed, from the signal</dt>
          <dd className={s.readoutValue}>{read.rpm === null ? "–" : rpm(read.rpm)}</dd>
        </div>
      </dl>
      {read.noisyFloor && (
        <p className={s.honest}>
          This pump runs on a noisy floor. A healthy pump here reads about the same level, so the level alone can't tell what is wrong.
          That is why Crux doesn't stop at the number: it tests every possible cause on a virtual copy of this pump.
        </p>
      )}
      {cap && cap.waveform.length > 0 && (
        <figure>
          <Waveform values={cap.waveform} label="The first quarter-second of the reading" />
          <figcaption className={s.muted}>
            The first quarter-second of the 2-second reading. <SourceTag>physics model · synthetic</SourceTag>
          </figcaption>
        </figure>
      )}
      {evidence && (
        <Section title="The evidence" aside="what the reading measured">
          <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Entry</th>
                <th>Measured</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {signal.map((e) => (
                <tr key={e.id}>
                  <td className={s.num}>{e.id}</td>
                  <td>{e.statement}</td>
                  <td className={s.num}>
                    {String(e.value)} {e.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Section>
      )}
      <div className={s.next}>
        <Button kind="primary" size="l" onClick={onNext}>
          Meet the suspects
        </Button>
      </div>
    </div>
  );
}
