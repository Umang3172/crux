// Proof, for judges: how well Crux does on hard cases, in the order a system
// that can say "I can't tell" should be judged. The synthetic set is labelled
// synthetic, real recordings say what has and hasn't been run, and nothing
// here is a number the project's own runs did not print.

import { useDataNote } from "../app/DataNote";
import { ByFault } from "./proof/ByFault";
import { CRUX, TOTAL } from "./proof/figures";
import { Measured } from "./proof/Measured";
import { Recordings } from "./proof/Recordings";
import { Refusals } from "./proof/Refusals";
import { RunIt } from "./proof/RunIt";
import { Scorecard } from "./proof/Scorecard";
import s from "./Proof.module.css";

const NOTE =
  "Synthetic cases are labelled synthetic. Every figure on this page comes from the project's own evaluation runs or from the public recordings named beside it.";

export default function Proof() {
  useDataNote(NOTE);
  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>
          On {TOTAL} hard synthetic cases, Crux was wrong {CRUX.wrong} times and said "can't tell" {CRUX.cantTell} times.
        </h1>
        <p className={s.sub}>
          A system that can decline is judged in this order: how often it answers alone, how often it needs a check, how
          often it declines, and only last how often it is wrong. These cases are synthetic: made by the same signal model
          Crux simulates with, so they test the decision rule, not how well the model fits a real machine.
        </p>
        <p className={s.source}>
          Source: the project's evaluation run, <code>hypengine evaluate</code>: {TOTAL} hard synthetic cases (three faults,
          three strengths, four noise levels, five seeds), re-run on the current engine.
        </p>
      </header>

      <Scorecard />

      <div className={s.grid}>
        <ByFault />
        <Recordings />
      </div>

      <div className={s.grid}>
        <Measured />
        <div className={s.stack}>
          <Refusals />
          <RunIt />
        </div>
      </div>
    </div>
  );
}
