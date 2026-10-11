// The answer, in the engine's own words: the cause in plain words, how far its
// belief is past the bar, what to do and why. The AI's words never appear
// here; its own reasons sit beside the engine's, labelled, further down.

import type { AgentRun, CaseView, Report } from "../../../api/types";
import { pct } from "../../../lib/format";
import { faultFull, fault, plainSentence } from "../../../lib/plain";
import { ButtonLink } from "../../../ui/Button";
import { Section } from "../../../ui/Section";
import { SourceTag } from "../../../ui/SourceTag";
import { Field, Fields } from "../../../ui/Tag";
import { conclusionOf, lineOf, type Turn } from "./derive";
import { AiNoCause } from "./AiNoCause";
import s from "./AiAnswer.module.css";

const capital = (t: string) => t.replace(/^./, (c) => c.toUpperCase());

export function AiAnswer({ c, run, turns, rep }: { c: CaseView; run: AgentRun; turns: Turn[]; rep: Report | null }) {
  if (c.status === "unresolved") return <AiNoCause c={c} run={run} rep={rep} />;
  if (c.status === "open") return <StillOpen c={c} run={run} />;

  const f = fault(c.leader);
  const suspect = c.suspects.find((x) => x.name === c.leader);
  const healthy = c.leader === "healthy";
  const written = suspect?.origin === "written";
  const action = lineOf(rep, "action");
  const given = conclusionOf(turns)?.answered ?? null;
  const why = rep?.lines.find((l) => l.part === "why") ?? null;
  const change = lineOf(rep, "change");
  const limit = lineOf(rep, "limit");
  const caveat = lineOf(rep, "caveat");
  const cites = (why?.cites ?? []).map((id) => rep?.evidence.find((e) => e.id === id)).filter((e): e is Report["evidence"][number] => !!e);

  return (
    <div className={s.stage}>
      <div className={s.verdict}>
        <h2 className={s.cause}>{f.name}</h2>
        <p className={s.technical}>{faultFull(c.leader)}</p>
        <div className={s.bar} role="img" aria-label={`Belief ${pct(c.leader_belief)}; Crux needs ${pct(c.conclude_at)}`}>
          <span className={s.fill} style={{ width: `${Math.min(100, c.leader_belief * 100)}%` }} />
          <span className={s.bar80} style={{ left: `${c.conclude_at * 100}%` }}>
            {pct(c.conclude_at)} to name a cause
          </span>
        </div>
        <p className={s.belief}>
          {pct(c.leader_belief)} belief <SourceTag>virtual experiments</SourceTag>
        </p>
      </div>
      <div className={s.fields}>
        <Fields columns={2}>
          <Field label="Where">{healthy ? "Nothing to open" : f.partName}</Field>
          <Field label="Came from">
            {written ? "Not on Crux's list. The AI wrote it and the physics tested it." : "Crux's own list of causes."}
          </Field>
          {action ? (
            <Field label="What to do" wide>
              {plainSentence(action)}
            </Field>
          ) : (
            given && (
              <Field label="The engine's answer" wide>
                {plainSentence(given)}
              </Field>
            )
          )}
          {change && (
            <Field label="What would change Crux's mind" wide>
              {capital(plainSentence(change))}
            </Field>
          )}
          {limit && (
            <Field label="Limit" wide>
              {plainSentence(limit)}
            </Field>
          )}
          {caveat && (
            <Field label="Caveat" wide>
              {plainSentence(caveat)}
            </Field>
          )}
        </Fields>
      </div>
      {why && (
        <Section title="Why" aside="the engine's own words" id="ai-why">
          <p>{plainSentence(why.text)}</p>
          {cites.length > 0 && (
            <p className={s.chips}>
              {cites.map((e) => (
                <span key={e.id} className={s.cite}>
                  {e.id} · {plainSentence(e.statement)}
                </span>
              ))}
            </p>
          )}
        </Section>
      )}
      <div className={s.next}>
        <ButtonLink to="/try">Investigate another fault</ButtonLink>
      </div>
    </div>
  );
}

/** The run ended before the case closed: say so rather than show an answer that is not there. */
function StillOpen({ c, run }: { c: CaseView; run: AgentRun }) {
  const waiting = c.requests.find((r) => r.status === "waiting");
  return (
    <div className={s.stage}>
      <h2 className={s.h2}>This case is still open.</h2>
      <p className={s.lead}>
        {waiting ? `It is waiting for a reading: ${waiting.test_name}.` : "The investigator stopped before the case closed."}{" "}
        {run.stopped ?? ""}
      </p>
      <p className={s.honest}>Nothing is marked on the machine, and there is no answer to act on yet.</p>
    </div>
  );
}
