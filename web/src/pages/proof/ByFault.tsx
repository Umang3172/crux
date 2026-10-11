// The evaluation table by true fault, as the command prints it: the numbers
// behind the scorecard, readable without the chart.

import { fault } from "../../lib/plain";
import { Section } from "../../ui/Section";
import { SourceTag } from "../../ui/SourceTag";
import { BY_FAULT, PER_FAULT, TOTAL } from "./figures";
import t from "./table.module.css";

const sum = (pick: (r: (typeof BY_FAULT)[number]) => number) => BY_FAULT.reduce((a, r) => a + pick(r), 0);

export function ByFault() {
  return (
    <Section title="By true fault" id="proof-by-fault" aside={<SourceTag>synthetic</SourceTag>}>
      <table className={t.table}>
        <caption className="visually-hidden">What Crux said on the {PER_FAULT} synthetic cases of each true fault</caption>
        <thead>
          <tr>
            <th scope="col">True fault</th>
            <th scope="col" className={t.num}>
              Right
            </th>
            <th scope="col" className={t.num}>
              Can't tell
            </th>
            <th scope="col" className={t.num}>
              Wrong
            </th>
            <th scope="col" className={t.num}>
              Asked a check
            </th>
            <th scope="col" className={t.num}>
              Best match right
            </th>
          </tr>
        </thead>
        <tbody>
          {BY_FAULT.map((r) => (
            <tr key={r.fault}>
              <th scope="row">{fault(r.fault).name}</th>
              <td className={t.num}>{r.right}</td>
              <td className={t.num}>{r.cantTell}</td>
              <td className={t.num}>{r.wrong}</td>
              <td className={t.num}>{r.asked}</td>
              <td className={t.num}>
                {r.bestRight} of {PER_FAULT}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">All</th>
            <td className={t.num}>{sum((r) => r.right)}</td>
            <td className={t.num}>{sum((r) => r.cantTell)}</td>
            <td className={t.num}>{sum((r) => r.wrong)}</td>
            <td className={t.num}>{sum((r) => r.asked)}</td>
            <td className={t.num}>
              {sum((r) => r.bestRight)} of {TOTAL}
            </td>
          </tr>
        </tfoot>
      </table>
    </Section>
  );
}
