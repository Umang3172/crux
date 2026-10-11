// How earlier cases on this pump ended. Shown to the person; the AI may ask for
// it through a tool, and either way it never moves a belief.

import type { AgentRun } from "../../../api/types";
import { stamp } from "../../../lib/format";
import { plainSentence } from "../../../lib/plain";
import { Block } from "./Block";
import { askedForMemory } from "./derive";
import s from "./Memory.module.css";

export function Memory({ run, scripted }: { run: AgentRun; scripted: boolean }) {
  const used = askedForMemory(run);
  return (
    <Block title="Earlier on this pump">
      {run.history.length === 0 ? (
        <p className={s.quiet}>No earlier cases on this pump.</p>
      ) : (
        <ul className={s.list}>
          {run.history.map((h) => (
            <li key={h.case_id}>
              <p>{plainSentence(h.sentence)}</p>
              <p className={s.when}>{stamp(h.closed_at)}</p>
            </li>
          ))}
        </ul>
      )}
      <p className={s.quiet}>
        {used
          ? "The AI asked for these in this run."
          : scripted
            ? "Shown to you; the stand-in investigator doesn't use it."
            : "Shown to you. The AI did not ask for these in this run."}{" "}
        Earlier cases never move a belief.
      </p>
    </Block>
  );
}
