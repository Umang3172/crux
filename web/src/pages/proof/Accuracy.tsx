// Accuracy comes last, and it is the point: Crux names a cause only when it is
// sure, so across 180 hard cases it named none wrongly, where the simplest
// thing that always answers named forty wrong. Each side shows all 180 cases
// as a tally, so the cost of declining sits next to the cost of guessing.

import { BEST, CRUX, CRUX_RIGHT, TOTAL, WHERE_BEST_WRONG } from "./figures";
import { Tally } from "./Tally";
import s from "./Accuracy.module.css";

export function Accuracy() {
  return (
    <div className={s.accuracy}>
      <div className={s.compare}>
        <section className={s.half} aria-labelledby="proof-crux">
          <h2 id="proof-crux" className={s.who}>
            Crux
          </h2>
          <p className={s.big}>
            <span className={s.num}>{CRUX.wrong}</span>
            <span className={s.what}>
              wrong answers
              <br />
              of the {CRUX_RIGHT} it named
            </span>
          </p>
          <Tally
            label={`Crux on ${TOTAL} cases: ${CRUX.alone} right without a check, ${CRUX.afterCheck} right after a check, ${CRUX.cantTell} said can't tell, ${CRUX.wrong} wrong.`}
            groups={[
              { kind: "right", count: CRUX.alone, label: "right, no check" },
              { kind: "check", count: CRUX.afterCheck, label: "right after a check" },
              { kind: "void", count: CRUX.cantTell, label: "can't tell" },
              { kind: "wrong", count: CRUX.wrong, label: "wrong" },
            ]}
          />
        </section>

        <section className={s.half} aria-labelledby="proof-best">
          <h2 id="proof-best" className={s.who}>
            Naming the best spectral match
          </h2>
          <p className={s.big}>
            <span className={s.num}>{BEST.wrong}</span>
            <span className={s.what}>
              wrong answers
              <br />
              of the {TOTAL}, because it always answers
            </span>
          </p>
          <Tally
            label={`The best spectral match on ${TOTAL} cases: ${BEST.right} right, ${BEST.wrong} wrong, none declined.`}
            groups={[
              { kind: "right", count: BEST.right, label: "right" },
              { kind: "wrong", count: BEST.wrong, label: "wrong" },
            ]}
          />
        </section>
      </div>
      <div className={s.costRow}>
        <p className={s.cost}>
          Against the best match, Crux ends with {BEST.right - CRUX_RIGHT} fewer right answers ({CRUX_RIGHT} against{" "}
          {BEST.right}), {BEST.wrong - CRUX.wrong} fewer wrong ones ({CRUX.wrong} against {BEST.wrong}), and{" "}
          {CRUX.cantTell} cases where it says it can't tell. In the {BEST.wrong} cases where the best match named the wrong
          fault, Crux said "can't tell" {WHERE_BEST_WRONG.cantTell} times and named the right cause{" "}
          {WHERE_BEST_WRONG.right} times.
        </p>
      </div>
    </div>
  );
}
