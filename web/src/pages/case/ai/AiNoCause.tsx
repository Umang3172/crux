// "Crux won't name a cause yet": the engine's reason and the investigator's
// own, side by side and never merged. Nothing is marked and no repair is
// offered on a guess.

import type { AgentRun, CaseView, Report } from "../../../api/types";
import { brainOf } from "../../../app/ai";
import { plainSentence } from "../../../lib/plain";
import { SourceTag } from "../../../ui/SourceTag";
import { lineOf, named } from "./derive";
import s from "./AiAnswer.module.css";

export function AiNoCause({ c, run, rep }: { c: CaseView; run: AgentRun; rep: Report | null }) {
  const action = lineOf(rep, "action");
  const brain = named(brainOf(run.model));
  return (
    <div className={s.stage}>
      <h2 className={s.h2}>Crux won't name a cause yet.</h2>
      <div className={s.voices}>
        <section className={s.voiceEngine} aria-label="The engine's reason">
          <h3 className={s.voiceLabel}>
            The engine's reason <SourceTag>engine</SourceTag>
          </h3>
          <p>{plainSentence(c.unresolved_reason ?? "The engine gave no reason.")}</p>
          {action && <p className={s.action}>{plainSentence(action)}</p>}
        </section>
        <section className={s.voiceModel} aria-label="The investigator's own reason">
          <h3 className={s.voiceLabel}>
            The investigator's own reason <SourceTag tone="model">{`Written by ${brain}`}</SourceTag>
          </h3>
          <p>
            {c.investigator_reason ??
              (run.stopped ? "None: the run was cut short, so the engine closed the case by its own rule." : "None given.")}
          </p>
        </section>
      </div>
      <p className={s.honest}>Don't open the machine on a guess. Nothing on it is marked, and there is no work order to draft.</p>
    </div>
  );
}
