// What was installed here, newest first: who approved it and when, and the
// test it passed. A roll back is a row of its own, so nothing is rewritten.

import type { BundleReport } from "../../api/types";
import { stamp } from "../../lib/format";
import type { HistoryEntry } from "./words";
import { modelLabel, plural, reportOf, rollbackOf, verdictOf, VERDICT_WORD } from "./words";
import s from "./History.module.css";

export function History({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) {
    return <p className={s.empty}>Nothing has been installed on this site yet.</p>;
  }
  return (
    <table className={s.table}>
      <caption className="visually-hidden">Updates installed or rolled back on this site, newest first</caption>
      <thead>
        <tr>
          <th scope="col">When</th>
          <th scope="col">What happened</th>
          <th scope="col">Approved by</th>
        </tr>
      </thead>
      <tbody>
        {[...entries].reverse().map((e, i) => (
          <tr key={`${e.at}-${i}`}>
            <td className={s.when}>{stamp(e.at)}</td>
            <td>{what(e)}</td>
            <td>{e.approved_by}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function what(e: HistoryEntry) {
  const from = rollbackOf(e);
  if (from !== null) {
    return (
      <>
        <strong>Rolled back</strong> from version {from} to {e.version === null ? "the trend line" : `version ${e.version}`}.
      </>
    );
  }
  const report = reportOf(e);
  return (
    <>
      <strong>Installed version {e.version}.</strong>
      {report && <span className={s.detail}>{testLine(report)}</span>}
    </>
  );
}

/** "Passed on 4 failures (learned model against trend line): no worse on error and on early end too late." */
function testLine(report: BundleReport): string {
  const on = report.runs ? ` on ${plural(report.runs, "failure")}` : "";
  const models =
    report.current && report.candidate
      ? ` (${modelLabel(report.candidate.model).name.toLowerCase()} against ${modelLabel(report.current.model).name.toLowerCase()})`
      : "";
  return `${VERDICT_WORD[verdictOf(report)]}${on}${models}: ${report.reason}.`;
}
