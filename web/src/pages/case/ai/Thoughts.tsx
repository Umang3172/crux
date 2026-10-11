// What a live model wrote about its own reasoning while it worked. Its words,
// labelled as its words, and kept apart from everything the engine said. The
// offline stand-in writes none, so on a stand-in run this row is not there.

import type { AgentRun } from "../../../api/types";
import { brainOf } from "../../../app/ai";
import { SourceTag } from "../../../ui/SourceTag";
import { named } from "./derive";
import { Fold } from "./Fold";
import s from "./Thoughts.module.css";

export function Thoughts({ run }: { run: AgentRun }) {
  if (run.thoughts.length === 0) return null;
  const brain = named(brainOf(run.model));
  return (
    <Fold title={`What ${brain} wrote about its own reasoning`}>
      <p className={s.lead}>
        <SourceTag tone="model">{`Written by ${brain}`}</SourceTag> A summary of its reasoning, as it wrote it. It moves nothing.
      </p>
      <ol className={s.list}>
        {run.thoughts.map((t, i) => (
          <li key={i} className={s.thought}>
            {t}
          </li>
        ))}
      </ol>
    </Fold>
  );
}
