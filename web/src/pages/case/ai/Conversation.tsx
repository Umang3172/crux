// The AI's work as a conversation, in the order it happened. Two columns tell
// the two voices apart at a glance: the AI on the left, what answered on the
// right. Where the other agent takes the case, a rule says so and what that
// agent is for, in the server's words.

import type { AgentAbout } from "../../../api/types";
import { rowsOf, type Turn } from "./derive";
import { TurnRow } from "./TurnRow";
import s from "./Conversation.module.css";

export function Conversation({ turns, about }: { turns: Turn[]; about: AgentAbout | null }) {
  const rows = rowsOf(turns);
  const jobOf = (agent: string) => about?.agents.find((a) => a.name === agent)?.job;
  if (rows.length === 0) return <p className={s.empty}>The investigator made no tool calls.</p>;
  return (
    <div className={s.conv}>
      <div className={s.heads} aria-hidden="true">
        <span />
        <p className={s.headAi}>
          <b>The AI</b>
          <span>what it asked and said</span>
        </p>
        <span />
        <p className={s.headAns}>
          <b>What answered</b>
          <span>physics, the engine, the machine's documents</span>
        </p>
      </div>
      <ol className={s.rows} aria-label="What the AI did, in order">
        {rows.map((r, i) =>
          r.kind === "handover" ? (
            <li key={`h-${i}`} className={s.handover}>
              <h3 className={s.handTitle}>{r.first ? `The ${r.agent} starts` : `The ${r.agent} takes over`}</h3>
              {jobOf(r.agent) && <p className={s.handJob}>{jobOf(r.agent)}</p>}
            </li>
          ) : (
            <TurnRow key={r.turn.n} turn={r.turn} />
          ),
        )}
      </ol>
    </div>
  );
}
