// The cases this browser opened on the pump, newest first, and how each one
// stands or ended. Each opens on the case page.

import { story } from "../../demo/stories";
import { pct, shortId, stamp } from "../../lib/format";
import { faultFull } from "../../lib/plain";
import { ButtonLink } from "../../ui/Button";
import { Section } from "../../ui/Section";
import type { CaseSummary } from "./nowStatus";
import s from "./CaseList.module.css";

function outcome(c: CaseSummary): string {
  switch (c.phase) {
    case "loading":
      return "Reading it…";
    case "lost":
      return c.kind === "ai" ? "This run is no longer kept in this browser." : "Lost: the server restarted and forgot it. Start it again.";
    case "error":
      return "The server didn't answer for this case.";
    case "investigating":
      return "Being investigated.";
    case "waiting":
      return `Waiting for a check${c.checkName ? `: ${c.checkName.toLowerCase()}` : ""}.`;
    case "concluded":
      return c.cause === "healthy" ? `Found nothing wrong, ${pct(c.belief)}.` : `${c.cause ? faultFull(c.cause) : "A cause"}, ${pct(c.belief)}.`;
    case "unresolved":
      return "Crux wouldn't name a cause.";
  }
}

export function CaseList({ cases }: { cases: CaseSummary[] }) {
  return (
    <Section title="Cases on this pump" aside="The ones this browser opened">
      {cases.length === 0 ? (
        <p className={s.none}>No cases yet. Investigate now starts one.</p>
      ) : (
        <ol className={s.list}>
          {cases.map((c) => (
            <li key={c.id} className={s.row}>
              <span className={s.id}>
                <strong className={s.name}>Case {shortId(c.id)}</strong>
                <span className={s.sub}>
                  {stamp(c.createdAt)} · {story(c.story)?.title ?? "Break the pump yourself"}
                </span>
                <span className={s.sub}>{c.kind === "ai" ? "AI investigator" : "Engine, with a person answering the check"}</span>
              </span>
              <span className={s.outcome}>{outcome(c)}</span>
              <ButtonLink to={`/case/${c.id}`} size="m">
                Open the case
              </ButtonLink>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
