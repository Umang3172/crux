// The update against the model in use, on this site's own failures. The
// numbers are the server's; they count up when the update has just arrived and
// are plain figures otherwise.

import type { BundleReport } from "../../api/types";
import { CountUp } from "../../ui/CountUp";
import { STEP } from "./useArrival";
import { modelLabel, share, type Side } from "./words";
import s from "./Tags.module.css";

type Measure = "error" | "late" | "inside";

const ROWS: { key: Measure; label: string; means: string; decides: boolean }[] = [
  {
    key: "error",
    label: "How far off",
    means: "the typical miss in time left, as a share of the time between the alarm and the failure",
    decides: true,
  },
  {
    key: "late",
    label: "Warned too late",
    means: "how often even the earliest end of the range said more time was left than there was",
    decides: true,
  },
  {
    key: "inside",
    label: "Inside the range",
    means: "how often the real time left fell inside the range; the aim is 80%",
    decides: false,
  },
];

export function TestTable({ report, step }: { report: BundleReport & { current: Side; candidate: Side }; step: number }) {
  const cur = modelLabel(report.current.model);
  const cand = modelLabel(report.candidate.model);
  const counting = step >= STEP.count;
  return (
    <div className={s.stack}>
      <table className={s.table}>
        <caption className="visually-hidden">The update against the model in use, on this site's own recorded failures</caption>
        <thead>
          <tr>
            <td />
            <th scope="col">
              <span className={s.colHead}>In use</span>
              <span className={s.colName}>{cur.name}</span>
            </th>
            <th scope="col">
              <span className={s.colHead}>This update</span>
              <span className={s.colName}>{cand.name}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => {
            const a = report.current[r.key];
            const b = report.candidate[r.key];
            const better = r.decides && a !== null && b !== null && a !== b ? (b < a ? "update" : "current") : null;
            return (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td className={better === "current" ? s.better : undefined}>
                  <Figure value={a} shown={counting} />
                </td>
                <td className={better === "update" ? s.better : undefined}>
                  <Figure value={b} shown={counting} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <dl className={s.means}>
        {ROWS.map((r) => (
          <div key={r.key}>
            <dt>{r.label}</dt>
            <dd>{r.means}.</dd>
          </div>
        ))}
      </dl>
      <p className={s.quiet}>The update can be installed only if it is no worse than the model in use on how far off and how often warned too late.</p>
    </div>
  );
}

/** Hidden until the update has reached the test, then counts up from nothing. */
function Figure({ value, shown }: { value: number | null; shown: boolean }) {
  if (value === null) return <>–</>;
  return (
    <span style={{ visibility: shown ? "visible" : "hidden" }}>
      <CountUp value={shown ? value : 0} format={share} />
    </span>
  );
}
