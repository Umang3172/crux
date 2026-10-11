// The one rule, shown through the real tool list. Nothing on this part of the
// page is typed in: the tools, what each takes and who may use it come from
// the server, and the claim is only made while that list backs it.

import { ErrorState, Loading } from "../../ui/States";
import { Icon } from "../../ui/Icon";
import { ToolList } from "./ToolList";
import { takesNoNumbers } from "./tools";
import { useAgentAbout } from "./useAgentAbout";
import s from "./Rule.module.css";

export function Rule() {
  const about = useAgentAbout();
  return (
    <div className={s.rule}>
      <div className={s.lead}>
        <h3 className={s.statement}>A language model never moves a belief.</h3>
        <p className={s.why}>The AI works only through tools. Here is the list the server reports; read the Takes column down it.</p>
      </div>
      {about.loading && !about.data && <Loading>Reading the tool list from the server…</Loading>}
      {about.error && !about.data && <ErrorState error={about.error} onRetry={about.reload} title="The tool list can't be read" />}
      {about.data && (
        <>
          {takesNoNumbers(about.data.tools) && (
            <>
              <ol className={s.chain} aria-label="The only road from a model to a belief">
                <li className={s.model}>
                  <b>The AI model</b>
                  <span>Asks and writes. What it writes carries its name.</span>
                </li>
                <li className={s.arrow} aria-hidden="true">
                  <Icon name="arrow-right" size={20} />
                </li>
                <li className={s.tools}>
                  <b>{about.data.tools.length} tools</b>
                  <span>Take a question, a name, an id, a reason or a suspect to test. No probability, no score, no reading.</span>
                </li>
                <li className={s.arrow} aria-hidden="true">
                  <Icon name="arrow-right" size={20} />
                </li>
                <li className={s.physics}>
                  <b>The physics</b>
                  <span>Simulates, scores and moves every belief.</span>
                </li>
              </ol>
              <p className={s.verified}>
                {about.data.tools.length} tools. None of them takes a probability, a score or a reading: only the physics moves a belief.
              </p>
            </>
          )}
          <ToolList about={about.data} />
          <p className={s.agents}>
            {about.data.agents.map((a) => (
              <span key={a.name}>
                <b>{a.name.replace(/^./, (c) => c.toUpperCase())}.</b> {a.job}{" "}
              </span>
            ))}
          </p>
        </>
      )}
    </div>
  );
}
