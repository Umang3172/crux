// This scan against the machine's own normal scan. Each shaft line's size is
// divided by the size of the measuring box, so a phone held closer does not
// look like a worse machine; a line that at least doubled counts as grown.

import { Link } from "react-router";
import type { ScanAnalysis } from "../../api/types";
import { num } from "../../lib/format";
import { Agreement } from "./Agreement";
import { orderText, upperFirst } from "./words";
import s from "./Change.module.css";

export function Change({ analysis }: { analysis: ScanAnalysis }) {
  const { change, normal_scan: normal } = analysis;
  if (!change || !normal) {
    return (
      <p className={s.quiet}>
        No normal scan of this machine was on file when this one was analysed. Keep a scan of it running well as its normal one, and later
        scans are compared with it.
      </p>
    );
  }
  const growth = Object.entries(change.growth)
    .map(([order, g]) => ({ order: Number(order), g }))
    .sort((a, b) => a.order - b.order);
  return (
    <div className={s.wrap}>
      <p className={s.quiet}>
        Compared with the normal scan <Link to={`/scans/${normal}`}>{normal}</Link>.
      </p>
      <ul className={s.growth} aria-label="How much each line grew against the normal scan">
        {growth.map(({ order, g }) => (
          <li key={order} className={g >= 2 ? s.grown : undefined}>
            <span className={s.order}>{orderText(order)}</span>
            <span className={s.times}>{num(g, 1)}×</span>
          </li>
        ))}
      </ul>
      {change.scores.length > 0 ? (
        <Agreement
          scores={change.scores}
          standing={[change.scores[0].kind]}
          label="Which fault's growth pattern the change matches"
        />
      ) : (
        <p>No shaft line doubled, so there is no sign of imbalance, misalignment or looseness growing.</p>
      )}
      {change.note && <p className={s.quiet}>{upperFirst(change.note)}</p>}
    </div>
  );
}
