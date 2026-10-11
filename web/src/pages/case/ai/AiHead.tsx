// Who investigated, and what the run record says, before anything else. The
// four figures are counted from the run the server returned; nothing is typed.

import type { AgentRun, CaseView } from "../../../api/types";
import { STAGES } from "../../../lib/case";
import { shortId } from "../../../lib/format";
import { useReducedMotion } from "../../../lib/hooks";
import { Button } from "../../../ui/Button";
import { Icon } from "../../../ui/Icon";
import { SourceTag } from "../../../ui/SourceTag";
import { StageLine } from "../../../ui/StageLine";
import { brainLine } from "./derive";
import s from "./AiHead.module.css";

export function AiHead({
  caseId,
  machineName,
  run,
  c,
  written,
  scripted,
}: {
  caseId: string;
  machineName: string;
  run: AgentRun;
  c: CaseView;
  /** Suspects the AI proposed, kept or refused. */
  written: number;
  /** Every step of the run was the offline stand-in's. */
  scripted: boolean;
}) {
  const reduce = useReducedMotion();
  // The one-check stage appears only when the investigator asked for a reading.
  const stages = STAGES.filter((st) => st.id !== "check" || c.requests.length > 0);
  const last = stages.length - 1;
  return (
    <div className={s.head}>
      <header className={s.top}>
        <div className={s.ident}>
          <div className={s.titleRow}>
            <h1 className={s.title}>{machineName}</h1>
            <span className={s.caseNo}>Case {shortId(caseId)}</span>
            <SourceTag>physics model · synthetic</SourceTag>
          </div>
          <p className={s.who}>
            Investigated by the AI investigator: <b>{brainLine(run)}</b>.
            {scripted ? " It is scripted: no language model wrote any of this run." : ""} The physics decided every belief.
          </p>
          <div>
            <Button
              kind="quiet"
              className={s.jump}
              onClick={() => document.getElementById("ai-work")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })}
            >
              See what the AI did
              <Icon name="arrow-down" size={16} />
            </Button>
          </div>
        </div>
        <dl className={s.facts} aria-label="The run record">
          <div className={s.fact}>
            <dt>Tool calls</dt>
            <dd>{run.tool_calls.length}</dd>
          </div>
          <div className={s.fact}>
            <dt>Rounds</dt>
            <dd>{run.rounds}</dd>
          </div>
          <div className={s.fact}>
            <dt>Suspects written</dt>
            <dd>{written}</dd>
          </div>
          <div className={s.fact}>
            <dt>Checks asked</dt>
            <dd>{c.requests.length}</dd>
          </div>
        </dl>
      </header>
      <StageLine stages={stages} reached={last} current={last} label="Stages of this investigation" />
    </div>
  );
}
