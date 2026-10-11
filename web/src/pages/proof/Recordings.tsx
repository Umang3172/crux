// Real recordings, one row per dataset, whatever the state is. No accuracy
// number on a real machine is shown until the diagnosis has been run on the
// current engine, so for now two of the three cells say so.

import { Section } from "../../ui/Section";
import { SourceTag } from "../../ui/SourceTag";
import t from "./table.module.css";

const ROWS = [
  {
    dataset: "XJTU-SY",
    kind: "15 bearings run to failure",
    run: "The watcher and the time-left forecast, below. An earlier diagnosis at the alarm was run before the engine changed.",
    result: "Diagnosis: to be re-run on the current engine. No number is shown.",
  },
  {
    dataset: "CWRU",
    kind: "Bearing recordings with known faults",
    run: "A loader and a benchmark exist. Nothing has been run on the real files.",
    result: "No result yet.",
  },
];

export function Recordings() {
  return (
    <Section title="Real recordings" id="proof-recordings" aside={<SourceTag>real recordings</SourceTag>}>
      <table className={t.table}>
        <caption className="visually-hidden">Where each real dataset stands</caption>
        <thead>
          <tr>
            <th scope="col">Dataset</th>
            <th scope="col">What has been run</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.dataset}>
              <th scope="row">
                {r.dataset}
                <span className={t.sub}>{r.kind}</span>
              </th>
              <td>{r.run}</td>
              <td>{r.result}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
