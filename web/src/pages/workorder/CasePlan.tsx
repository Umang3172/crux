// The plan for a demo-pump work order, composed here from the engine's case and
// its report. Every sentence is the engine's own, with the evidence it rests on;
// a language model's plain words, when one is on, come after and carry its name.

import { useMemo } from "react";
import { Link } from "react-router";
import type { Report } from "../../api/types";
import { brainOf } from "../../app/ai";
import { caseEntry, useWorld } from "../../demo/world";
import { pct } from "../../lib/format";
import { useCatalogue, useHealth } from "../../lib/hooks";
import { CONCLUDE_AT, fault, plainSentence } from "../../lib/plain";
import { ButtonLink } from "../../ui/Button";
import { Empty, ErrorState, Loading } from "../../ui/States";
import { SourceTag } from "../../ui/SourceTag";
import { Field } from "../../ui/Tag";
import { Approval } from "./Approval";
import { caseLookup, type Lookup } from "./evidence";
import { Cites } from "./EvidenceChip";
import type { HazardOn } from "./hazard";
import { HazardLine } from "./HazardLine";
import { laterOf, patchOrder, writerName } from "./model";
import type { StageProps } from "./types";
import type { CaseCore } from "./useCaseCore";
import { useCaseReport } from "./useCaseReport";
import c from "./CasePlan.module.css";
import s from "./stage.module.css";

const SAFETY =
  "Crux only recommends. A person approves this work order, and the machine is isolated and locked out under the site's own procedure before anyone works on it.";

type Line = Report["lines"][number];

function Sentence({ line, lookup, big }: { line: Line; lookup: Lookup; big?: boolean }) {
  return (
    <p className={big ? s.lead : s.sentence}>
      {plainSentence(line.text)}
      <Cites ids={line.cites} lookup={lookup} />
    </p>
  );
}

export function CasePlan({ wo, go, core, hazard }: StageProps & { core: CaseCore; hazard: HazardOn | null }) {
  const world = useWorld();
  const catalogue = useCatalogue();
  const health = useHealth();
  const nameable = core.outcome === "concluded" && core.cause !== null && core.cause !== "healthy";
  const rep = useCaseReport(wo.caseId, nameable);
  const entry = wo.caseId ? caseEntry(world, wo.caseId) : undefined;
  const report = rep.report;
  const lookup = useMemo(() => caseLookup(report?.evidence ?? [], core.notes, entry, catalogue.data), [report, core.notes, entry, catalogue.data]);

  if (core.loading) return <div className={s.pad}><Loading>Loading the plan…</Loading></div>;
  if (core.lost) {
    return (
      <Field label="Case lost" wide>
        <p className={s.sentence}>This case was kept in the server's memory and the server restarted. Start it again.</p>
        <p className={s.quiet}>What this work order already recorded is kept in this browser. Its plan can't be written again.</p>
        <div className={s.row}>
          <ButtonLink to="/try" kind="primary">Break the pump again</ButtonLink>
          <ButtonLink to="/">Back to the plant</ButtonLink>
        </div>
      </Field>
    );
  }
  if (core.error) return <div className={s.pad}><ErrorState error={core.error} onRetry={core.reload} /></div>;
  if (!nameable) {
    return (
      <div className={s.pad}>
        <Empty title="There is no repair to plan">
          <div className={c.stack}>
            <p>
              {core.cause === "healthy"
                ? "The verdict on this case was that nothing is wrong, so there is nothing to repair."
                : "Crux did not name a cause on this case, and it won't send anyone into a machine on a guess."}
            </p>
            <div className={s.row}>
              <ButtonLink to={`/case/${wo.caseId}`}>Open the case</ButtonLink>
            </div>
          </div>
        </Empty>
      </div>
    );
  }

  const named = fault(core.cause ?? "");
  const engine = (part: string): Line | undefined => report?.lines.find((l) => l.part === part && l.by === "engine");
  const verdict = engine("verdict");
  const change = engine("change");
  const written = report?.lines.filter((l) => l.by !== "engine") ?? [];
  const removed = rep.full?.removed ?? [];
  const writer = rep.full ? writerName(rep.full.explained_by) : "";
  const modelOn = brainOf(health.data?.models.report_writer).live;

  function approve(name: string) {
    patchOrder(wo.id, (o) => ({ ...o, approvedBy: name, approvedAt: Date.now(), stage: laterOf(o.stage, "repair") }));
    go("plan");
  }

  return (
    <div className={s.split}>
      <div className={s.main}>
        {hazard && (
          <HazardLine hazard={hazard} link={<Link to={`/case/${wo.caseId}`}>Open the case</Link>} />
        )}
        <Field label="What's wrong" wide>
          <div className={c.cause}>
            <div>
              <h2 className={c.name}>{named.name}</h2>
              <p className={s.quiet}>
                {named.technical && named.technical !== named.name.toLowerCase() ? `${named.technical} · ` : ""}
                {named.partName}
              </p>
            </div>
            <div className={c.belief}>
              <span className={s.figure}>{pct(core.belief)}</span>
              <span className={c.gauge} role="img" aria-label={`Belief ${pct(core.belief)}; Crux needs ${pct(CONCLUDE_AT)}`}>
                <span className={c.fill} style={{ width: `${Math.min(100, (core.belief ?? 0) * 100)}%` }} />
                <span className={c.bar} style={{ left: `${CONCLUDE_AT * 100}%` }} />
              </span>
              <span className={s.status}>
                belief, from the virtual experiments · Crux needs {pct(CONCLUDE_AT)} to name a cause
              </span>
              <SourceTag>virtual experiment</SourceTag>
            </div>
          </div>
          {verdict ? <Sentence line={verdict} lookup={lookup} /> : null}
        </Field>
        {!report && !rep.engineError && (
          <div className={s.pad}><Loading>Writing the plan from the engine's report…</Loading></div>
        )}
        {rep.engineError && !report && (
          <div className={s.pad}><ErrorState error={rep.engineError} onRetry={rep.reload} title="The report didn't load" /></div>
        )}
        {(["action", "why"] as const).map((part) => {
          const line = engine(part);
          return line ? (
            <Field key={part} label={part === "action" ? "What to do" : "Why Crux thinks so"} wide>
              <Sentence line={line} lookup={lookup} big={part === "action"} />
            </Field>
          ) : null;
        })}
        {change && (
          <Field label="What would change its mind" wide>
            <Sentence line={change} lookup={lookup} />
            {/temp_rise_c|temperature/.test(change.text) && (
              <p className={s.quiet}>The temperature check it names is scored against a first-pass table that has not been measured on a machine.</p>
            )}
          </Field>
        )}
        {(["limit", "caveat"] as const).map((part) => {
          const line = engine(part);
          return line ? (
            <Field key={part} label={part === "limit" ? "Limit" : "Caveat"} wide>
              <Sentence line={line} lookup={lookup} />
            </Field>
          ) : null;
        })}
        {written.length > 0 && (
          <Field label="In plain words" wide>
            <p className={s.row}>
              <SourceTag tone="model">{`written by ${writer}`}</SourceTag>
              <span className={s.status}>Each sentence is kept only if the evidence it cites backs it.</span>
            </p>
            {written.map((l) => (
              <Sentence key={l.text} line={l} lookup={lookup} />
            ))}
          </Field>
        )}
        {rep.pending && modelOn && report && (
          <Field label="In plain words" wide>
            <p className={s.status} role="status">
              {brainOf(health.data?.models.report_writer).name} is writing a plain-words version. That can take half a minute. The engine's own sentences are the whole plan without it.
            </p>
          </Field>
        )}
        {rep.fullError && (
          <Field label="In plain words" wide>
            <p className={s.status}>
              The plain-words version could not be written ({rep.fullError.message}). The engine's own sentences are the whole plan.
            </p>
          </Field>
        )}
        {rep.full && rep.full.notes.length > 0 && (
          <Field label="About these words" wide>
            {rep.full.notes.map((n) => (
              <p key={n} className={s.quiet}>
                {n}
              </p>
            ))}
          </Field>
        )}
        {removed.length > 0 && (
          <Field label={`Removed by the check (${removed.length})`} wide>
            <ul className={c.removed}>
              {removed.map((r) => (
                <li key={r.text}>
                  <span className={c.struck}>{r.text}</span>
                  <Cites ids={r.cites} lookup={lookup} />
                  <span className={s.quiet}>Removed because {r.why}.</span>
                </li>
              ))}
            </ul>
          </Field>
        )}
      </div>
      <div className={s.side}>
        <Approval
          approvedBy={wo.approvedBy}
          approvedAt={wo.approvedAt}
          onApprove={approve}
          onNext={() => go("repair")}
          nextLabel="Continue to the repair"
          safety={SAFETY}
        />
      </div>
    </div>
  );
}
