// How a judge checks the numbers: one command, no keys, no hardware.

import { Icon } from "../../ui/Icon";
import { Section } from "../../ui/Section";
import { COMMAND, REPO } from "./figures";
import s from "./RunIt.module.css";

export function RunIt() {
  return (
    <Section title="Run it yourself" id="proof-run">
      <p className={s.text}>The same 180 cases, offline, with no keys. It prints the totals and the table by fault.</p>
      <pre className={s.code}>
        <code>{COMMAND}</code>
      </pre>
      <p className={s.small}>
        <code>--quick</code> runs 18 of the cases in about half a minute. The split by whether a check was asked, and the
        comparison with the best match case by case, are counted from the same runs; the command prints the totals and the
        table by fault.
      </p>
      <p>
        <a className={s.link} href={REPO} target="_blank" rel="noreferrer">
          The code and its notes, on GitHub
          <Icon name="external" size={16} />
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      </p>
    </Section>
  );
}
