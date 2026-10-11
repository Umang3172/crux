// Every suspect on one rack. One the AI wrote joins it marked as the AI's and
// tested by the physics; one it wrote from the machine's notes says which
// passage; one the physics refused shows why. Ruled-out tags stay, punched.

import type { CaseView } from "../../../api/types";
import { pct } from "../../../lib/format";
import { plainSentence } from "../../../lib/plain";
import { Section } from "../../../ui/Section";
import { SourceTag } from "../../../ui/SourceTag";
import { SuspectRack } from "../../../ui/SuspectRack";
import { blockerOf, experimentsLine, rackOf, sentence, type Proposal } from "./derive";
import s from "./AiSuspects.module.css";

export function AiSuspects({ c, proposals }: { c: CaseView; proposals: Proposal[] }) {
  const ruled = c.suspects.filter((x) => x.status === "rejected" || x.status === "refused").length;
  const verdict = c.status === "concluded" ? c.leader : null;
  const blocker = c.critic_consulted ? blockerOf(c) : null;
  const sourced = c.suspects.filter((x) => x.source);
  const experiments = experimentsLine(c);
  return (
    <Section title="Suspects" id="ai-suspects" aside={`${c.suspects.length} suspects, ${ruled} ruled out`}>
      <SuspectRack
        suspects={rackOf(c, proposals)}
        leaders={verdict ? [verdict] : []}
        verdict={verdict}
        caption={`Crux needs ${pct(c.conclude_at)} to name a cause.${experiments ? ` ${experiments}` : ""}`}
      />
      {(blocker || sourced.length > 0) && (
        <div className={s.lines}>
          {blocker && (
            <p className={s.line}>
              <SourceTag>engine</SourceTag>
              <span>
                <b>{proposals.length > 0 ? "What made the AI write a suspect: " : "What made the AI call in the critic: "}</b>
                {plainSentence(blocker)}
              </span>
            </p>
          )}
          {sourced.map((x) => (
            <p key={x.name} className={s.line}>
              <SourceTag tone="model">machine's notes</SourceTag>
              <span>
                <b>{sentence(x.label)}</b> comes from the machine's notes: {x.source}. These notes are a demo document written for this
                project, not a manufacturer's manual.
              </span>
            </p>
          ))}
        </div>
      )}
    </Section>
  );
}
