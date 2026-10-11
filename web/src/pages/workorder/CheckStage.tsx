// The repair check: Crux investigated the pump as it runs after the repair, from
// scratch. The outcome is said in plain words, with the engine's own sentence,
// the limit and the caveat always in view, and the lines before and after.

import { pct, signed } from "../../lib/format";
import { fault, plainSentence } from "../../lib/plain";
import { Button } from "../../ui/Button";
import { SourceTag } from "../../ui/SourceTag";
import { Field } from "../../ui/Tag";
import { Counted } from "./Counted";
import { LineBars } from "./LineBars";
import { choiceTitle, laterOf, OUTCOME, patchOrder } from "./model";
import type { StageProps } from "./types";
import { usePlayOnce } from "./usePlayOnce";
import c from "./CheckStage.module.css";
import s from "./stage.module.css";

export function CheckStage({ wo, go }: StageProps) {
  const done = wo.repair;
  const play = usePlayOnce(`check:${wo.id}:${done?.at ?? 0}`);
  const closed = wo.stage === "closed";

  if (!done) {
    return (
      <div className={s.main}>
        <Field label="No repair yet" wide>
          <p className={s.sentence}>The check follows a repair. Choose what the repair did first.</p>
        </Field>
        <div className={s.actions}>
          <Button kind="primary" onClick={() => go("repair")}>
            Back to the repair
          </Button>
        </div>
      </div>
    );
  }

  const r = done.result;
  const words = OUTCOME[r.outcome];
  const now = r.found ? fault(r.found) : null;
  const rest = r.after.hypotheses
    .filter((h) => !h.rejected && h.kind !== r.found)
    .sort((a, b) => b.posterior - a.posterior)
    .slice(0, 3);

  function next() {
    patchOrder(wo.id, (o) => ({ ...o, stage: laterOf(o.stage, "found") }));
    go("found");
  }

  return (
    <div className={s.split}>
      <div className={s.main}>
        <Field label="Result" wide>
          <h2 className={c.outcome} data-tone={words.tone}>
            {words.head}
          </h2>
          <p className={s.quiet}>
            Repair chosen: {choiceTitle(done.choice).toLowerCase()}. Crux took a new capture of the pump after it and investigated that from scratch.
          </p>
          {r.belief !== null && now && (
            <div className={c.belief}>
              <span className={s.figureLarge}>
                <Counted from={0} value={r.belief} play={play} format={pct} />
              </span>
              <div className={c.beliefText}>
                <p className={c.beliefName}>{now.name}</p>
                <p className={s.status}>belief, from the virtual experiments on the new capture</p>
                <SourceTag>virtual experiment</SourceTag>
              </div>
            </div>
          )}
          <p className={s.sentence}>{plainSentence(r.statement)}</p>
          {rest.length > 0 && (
            <p className={s.quiet}>
              Not ruled out after the repair: {rest.map((h) => `${fault(h.kind).name.toLowerCase()} ${pct(h.posterior)}`).join(", ")}.
            </p>
          )}
        </Field>
        {r.limit && (
          <Field label="Limit" wide>
            <p className={s.sentence}>
              {plainSentence(r.limit)}
              {r.limit_names_cause ? " Check again on the next round to be sure." : ""}
            </p>
          </Field>
        )}
        {r.caveat && (
          <Field label="Caveat" wide>
            <p className={s.sentence}>{plainSentence(r.caveat)}</p>
            {r.outcome === "verified" && (
              <p className={s.quiet}>The verified result above rests on a reading scored against that table.</p>
            )}
          </Field>
        )}
        {r.asked.length > 0 && (
          <Field label="Readings taken during the check" wide>
            <ul className={c.asked}>
              {r.asked.map((name, i) => {
                const o = r.after.outcomes[i];
                return (
                  <li key={`${name}${i}`}>
                    <span>
                      {name}
                      {o ? `: ${signed(o.value, 2)}${o.feature === "temp_rise_c" ? " °C" : ""}` : ""}
                    </span>
                    <SourceTag>virtual instrument</SourceTag>
                  </li>
                );
              })}
            </ul>
            <p className={s.quiet}>The pump model's virtual instrument answers these from the state the repair left it in.</p>
          </Field>
        )}
        <div className={s.actions}>
          {closed ? (
            <span className={s.status}>This work order is closed.</span>
          ) : (
            <>
              <Button kind="primary" size="l" onClick={next}>
                Record what was found
              </Button>
              <Button kind="quiet" onClick={() => go("repair")}>
                Try a different repair
              </Button>
            </>
          )}
        </div>
      </div>
      <div className={s.side}>
        <Field label="The lines before and after" wide>
          {r.lines.length > 0 ? (
            <div className={c.chartField}>
              <LineBars rows={r.lines} play={play} />
              <p className={s.quiet}>
                Each line is a peak measured in multiples of the floor around it; 1× means it isn't there. The healthy mark is{" "}
                {r.usual_from === "healthy captures" ? "this machine's own healthy captures" : "a healthy pump simulated at the same length and noise"}.
              </p>
              <SourceTag>physics model · synthetic</SourceTag>
            </div>
          ) : (
            <p className={s.quiet}>The engine found no line this fault makes that the new capture could show.</p>
          )}
        </Field>
      </div>
    </div>
  );
}
