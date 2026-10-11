// The AI's work, start to finish: who took each step and what the physics
// answered, then the suspects it wrote, the limits it ran inside, the memory
// it was shown, and the tool list it is held to. The AI's words carry its name
// everywhere; the answers never do.

import type { AgentRun, CaseView } from "../../../api/types";
import { list } from "../../../lib/format";
import { Section } from "../../../ui/Section";
import { useAgentAbout } from "../../how/useAgentAbout";
import { Capabilities } from "./Capabilities";
import { Conversation } from "./Conversation";
import { brainOfTurn, named, plural, type Proposal, type Turn } from "./derive";
import { Limits } from "./Limits";
import { Memory } from "./Memory";
import { Thoughts } from "./Thoughts";
import { Written } from "./Written";
import s from "./Work.module.css";

export function Work({
  run,
  c,
  turns,
  proposals,
  scripted,
}: {
  run: AgentRun;
  c: CaseView;
  turns: Turn[];
  proposals: Proposal[];
  scripted: boolean;
}) {
  const about = useAgentAbout();
  const brains = [...new Set(turns.map((t) => named(brainOfTurn(t))))];
  const agents = [...new Set(turns.map((t) => t.agent))];
  return (
    <Section title="What the AI did" id="ai-work" aside={`${plural(run.tool_calls.length, "tool call")} in ${plural(run.rounds, "round")}`}>
      <p className={s.intro}>
        {agents.length > 1
          ? `Two agents worked this case: the ${agents.join(" and the ")}.`
          : agents.length === 1
            ? `The ${agents[0]} worked this case.`
            : ""}
        {brains.length > 0
          ? ` ${brains.length > 1 ? "They ran on" : agents.length > 1 ? "Both ran on" : "It ran on"} ${list(brains)}.`
          : ""}{" "}
        The AI works only through tools, and the physics answers every one. A <span className={s.dashed}>dashed box</span> is the AI: what
        it asked and said. A <span className={s.solid}>solid slip</span> is what answered. The AI never moves a belief.
      </p>
      {run.fallback && (
        <p className={s.notice} role="note">
          <b>The AI stopped part-way.</b> {run.fallback} The offline stand-in finished the case; each step below names who took it.
        </p>
      )}
      {run.stopped && (
        <p className={s.notice} role="note">
          <b>The run was cut short.</b> {run.stopped}{" "}
          {c.status === "open" ? "The case is still open." : "The engine closed the case by its own rule."}
        </p>
      )}
      <Conversation turns={turns} about={about.data} />
      <div className={s.blocks}>
        <Written proposals={proposals} />
        <Limits run={run} about={about.data} />
        <Memory run={run} scripted={scripted} />
      </div>
      <Capabilities about={about} />
      <Thoughts run={run} />
    </Section>
  );
}
