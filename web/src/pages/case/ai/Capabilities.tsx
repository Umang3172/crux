// What the model can do: every tool the server gives the AI, what each takes,
// and which of the two agents may use it. Collapsed, because the conversation
// above already shows the tools being used.

import type { AgentAbout } from "../../../api/types";
import type { Async } from "../../../lib/hooks";
import { ErrorState, Loading } from "../../../ui/States";
import { ToolList } from "../../how/ToolList";
import { takesNoNumbers } from "../../how/tools";
import { Fold } from "./Fold";
import s from "./Capabilities.module.css";

export function Capabilities({ about }: { about: Async<AgentAbout> }) {
  return (
    <Fold title="What the model can do">
      {about.data && (
        <>
          <p className={s.lead}>{about.data.tools.length} tools, as the server reports them, and which of the two agents may use each.</p>
          <ToolList about={about.data} detail />
          {takesNoNumbers(about.data.tools) && (
            <p className={s.rule}>None of them takes a probability, a score or a reading: only the physics moves a belief.</p>
          )}
        </>
      )}
      {!about.data && about.loading && <Loading>Reading the tool list from the server…</Loading>}
      {!about.data && about.error && <ErrorState error={about.error} onRetry={about.reload} title="The tool list can't be read" />}
    </Fold>
  );
}
