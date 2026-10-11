// One step of the AI's work: what it asked or said on the left, in a dashed
// box with its name on it, and what answered it on the right, in a solid slip.
// Narration has no answer and runs the full width.

import { SourceTag } from "../../../ui/SourceTag";
import { Icon } from "../../../ui/Icon";
import { capital, toolText } from "../../how/tools";
import { after, brainOfTurn, named, proposedName, sentence, type Turn } from "./derive";
import { TurnAnswer } from "./TurnAnswer";
import s from "./TurnRow.module.css";

/** The part of a step the AI itself wrote, beyond which tool it called. */
function Body({ turn }: { turn: Turn }) {
  switch (turn.tool) {
    case "narrate":
      return (
        <>
          <p className={s.said}>“{turn.asked}”</p>
          <p className={s.fine}>Narration for the people watching. It is never used as evidence and moves nothing.</p>
        </>
      );
    case "propose_suspect": {
      // The server puts the suspect's name first; what follows is the AI's own description.
      const rest = turn.asked.replace(/^Write a new suspect, [^.]*\.\s*/, "");
      return (
        <>
          <p className={s.subject}>{sentence(proposedName(turn))}</p>
          <p className={s.said}>“{rest}”</p>
        </>
      );
    }
    case "search_knowledge":
      return <p className={s.said}>“{after(turn.asked, "Look in the machine's documents: ")}”</p>;
    case "declare_unresolved":
      return (
        <>
          <p className={s.fine}>Its own reason</p>
          <p className={s.said}>“{after(turn.asked, "Close the case without a verdict. ")}”</p>
        </>
      );
    case "request_measurement":
      return <p className={s.said}>{after(turn.asked, "Request the measurement: ")}</p>;
    default:
      return null;
  }
}

export function TurnRow({ turn }: { turn: Turn }) {
  const t = toolText(turn.tool);
  const brain = brainOfTurn(turn);
  const says = turn.kind === "says";
  const writes = says || turn.tool === "propose_suspect";
  return (
    <li className={[s.row, says ? s.says : ""].filter(Boolean).join(" ")} id={`ai-step-${turn.n}`}>
      <span className={s.n}>
        <span className="visually-hidden">Step </span>
        {turn.n}
      </span>
      <div className={s.ask}>
        <p className={s.who}>
          <span className={s.agent}>{capital(turn.agent)}</span>
          <SourceTag tone="model">{`${writes ? "Written by" : "Asked by"} ${named(brain)}`}</SourceTag>
        </p>
        <p className={s.phrase}>{says ? "Says" : capital(t.phrase)}</p>
        <Body turn={turn} />
      </div>
      {!says && (
        <>
          <span className={s.arrow} aria-hidden="true">
            <Icon name="arrow-right" size={20} />
          </span>
          <div className={s.answer}>
            <TurnAnswer turn={turn} />
          </div>
        </>
      )}
    </li>
  );
}
