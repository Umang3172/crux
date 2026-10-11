// What answered the AI: the physics, the engine, the machine's documents or
// the virtual instrument. A solid slip with an ink head, in ink: never the
// AI's words, which are always in the dashed box beside it.

import { plainSentence } from "../../../lib/plain";
import { toolText } from "../../how/tools";
import type { Turn } from "./derive";
import { Figures } from "./Figures";
import s from "./TurnAnswer.module.css";

export function TurnAnswer({ turn }: { turn: Turn }) {
  const t = toolText(turn.tool);
  const answer = turn.answered === null ? null : plainSentence(turn.answered);
  return (
    <div className={s.slip}>
      <p className={s.head}>{t.answeredBy}</p>
      <div className={s.body}>
        <p>{answer === null ? "No answer came back." : <Figures text={answer} />}</p>
        {turn.tool === "search_knowledge" && answer && /Best match/.test(answer) && (
          <p className={s.fine}>A demo document written for this project, not a manufacturer's manual.</p>
        )}
        {turn.tool === "request_measurement" && answer && /reading came back/i.test(answer) && (
          <p className={s.fine}>The pump model's virtual instrument answers from the fault it was given.</p>
        )}
      </div>
    </div>
  );
}
