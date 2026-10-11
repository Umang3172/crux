// Every tool the AI can call, as the server reports it, and which of the two
// agents may use it. Read the "Takes" column down: questions, names, ids and a
// suspect to test, never a probability, a score or a reading.

import type { AgentAbout } from "../../api/types";
import { Icon } from "../../ui/Icon";
import { capital, takesText, toolText } from "./tools";
import s from "./ToolList.module.css";

export function ToolList({
  about,
  detail = false,
}: {
  about: AgentAbout;
  /** Also print the server's own sentence for each tool. */ detail?: boolean;
}) {
  const can = (agent: string, tool: string) => about.agents.find((a) => a.name === agent)?.tools.includes(tool) ?? false;
  return (
    <div className={s.scroll}>
      <table className={s.table}>
        <caption className="visually-hidden">The AI's tools, what each takes, and which agent may use it</caption>
        <thead>
          <tr>
            <th scope="col">Tool</th>
            <th scope="col">Takes</th>
            {about.agents.map((a) => (
              <th key={a.name} scope="col" className={s.agent}>
                {capital(a.name)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {about.tools.map((t) => (
            <tr key={t.name}>
              <th scope="row" className={s.tool}>
                <span className={s.phrase}>{capital(toolText(t.name).phrase)}</span>
                <code className={s.code}>{t.name}</code>
                {detail && <span className={s.does}>{t.does}</span>}
              </th>
              <td className={s.takes}>{takesText(t.takes)}</td>
              {about.agents.map((a) => (
                <td key={a.name} className={s.mark}>
                  {can(a.name, t.name) ? (
                    <>
                      <Icon name="check" size={18} />
                      <span className="visually-hidden">{capital(a.name)} may use this</span>
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true" className={s.none}>
                        –
                      </span>
                      <span className="visually-hidden">{capital(a.name)} may not use this</span>
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
