// What the server remembers of earlier cases on this pump. Shown so a person
// can see how the pump has done before; it never changes the odds in a case.

import type { CaseRecord } from "../../api/types";
import { stamp } from "../../lib/format";
import { plainSentence } from "../../lib/plain";
import { Section } from "../../ui/Section";
import s from "./EarlierCases.module.css";

export function EarlierCases({ history }: { history: CaseRecord[] }) {
  return (
    <Section title="Earlier on this pump" aside="Context only: earlier cases never change the odds">
      {history.length === 0 ? (
        <p className={s.none}>No earlier cases on this pump yet.</p>
      ) : (
        <ul className={s.list}>
          {history.map((h) => (
            <li key={h.case_id} className={s.row}>
              <span className={s.when}>{stamp(h.closed_at)}</span>
              <span>{plainSentence(h.sentence)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className={s.source}>Kept by the server for this browser's demo plant.</p>
    </Section>
  );
}
