// Where the case stands, in the engine's own words. A language model's words
// never appear in this card: they are in the report, under the model's name.

import { CircleCheck, CircleHelp, Hourglass, LoaderCircle } from "lucide-react";
import type { Conclusion, Report } from "../../api/types";
import type { CaseModel } from "../../lib/casemodel";
import { pct } from "../../lib/format";
import { fault, plainSentence } from "../../lib/plain";
import { Badge, Callout, Card, Meter } from "../../ui/kit";

const line = (r: Report | null, part: string) => r?.lines.find((l) => l.part === part && l.by === "engine")?.text ?? null;

export function VerdictCard({ model, conclusion, report }: { model: CaseModel; conclusion: Conclusion | null; report: Report | null }) {
  const leader = model.leader;

  if (model.status === "concluded" && leader) {
    const f = fault(leader.kind);
    const healthy = leader.kind === "healthy";
    const why = conclusion?.reasoning ?? line(report, "why");
    const action = conclusion?.recommended_action ?? line(report, "action");
    const change = conclusion?.what_would_change_my_mind ?? line(report, "change");
    const limit = conclusion?.limit || line(report, "limit");
    const caveat = conclusion?.caveat || line(report, "caveat");
    const unseen = model.suspects.filter((s) => s.state === "unseen");
    return (
      <Card tone="ok" title="Verdict" icon={<CircleCheck size={15} />} actions={<Badge tone="accent">the engine's words</Badge>}>
        <div className="verdict">
          <div>
            <div className="eyebrow">{healthy ? "Nothing to repair" : "Cause named"}</div>
            <h3>{f.name}</h3>
            <div className="row row-wrap small muted" style={{ marginTop: 6 }}>
              <span className="mono">{f.technical}</span>
              {!healthy && <span>· {f.partName}</span>}
              {leader.origin === "written" && <Badge tone="model">written during the case</Badge>}
            </div>
          </div>
          <div className="verdict-belief">
            <div className="row between">
              <span className="big">{pct(leader.belief)}</span>
              <span className="small dim" style={{ textAlign: "right" }}>
                belief
                <br />
                bar {pct(model.concludeAt)}
              </span>
            </div>
            <div style={{ marginTop: 12 }}>
              <Meter value={leader.belief ?? 0} mark={model.concludeAt} tone="ok" large />
            </div>
          </div>
        </div>

        {leader.origin === "written" && (
          <div style={{ marginTop: 16 }}>
            <Callout tone="model">
              This cause is not on the engine's list. The critic wrote it as a suspect during the case; the physics then simulated and scored it like any other.
              {leader.source && (
                <>
                  {" "}
                  It cites <b>{leader.source}</b>.
                </>
              )}
            </Callout>
          </div>
        )}

        <dl className="voice">
          {why && (
            <>
              <dt>Why</dt>
              <dd>{plainSentence(why)}</dd>
            </>
          )}
          {action && (
            <>
              <dt>What to do</dt>
              <dd className="strong">{action}</dd>
            </>
          )}
          {change && (
            <>
              <dt>Would change this</dt>
              <dd>{plainSentence(change)}</dd>
            </>
          )}
          {limit && (
            <>
              <dt>Limit</dt>
              <dd>{limit}</dd>
            </>
          )}
          {unseen.length > 0 && !limit && (
            <>
              <dt>Cannot exclude</dt>
              <dd>A mild case of {unseen.map((s) => fault(s.kind).name.toLowerCase()).join(", ")} would look the same in this evidence.</dd>
            </>
          )}
          {caveat && (
            <>
              <dt>Caveat</dt>
              <dd>{caveat}</dd>
            </>
          )}
        </dl>
      </Card>
    );
  }

  if (model.status === "unresolved") {
    return (
      <Card title="Verdict" icon={<CircleHelp size={15} />} actions={<Badge tone="accent">the engine's words</Badge>}>
        <div className="eyebrow">No cause named</div>
        <h3 style={{ fontSize: "1.5rem", fontWeight: 640, letterSpacing: "-0.02em", marginTop: 4 }}>Crux will not name a cause on this evidence</h3>
        <p className="muted" style={{ marginTop: 10, maxWidth: "80ch" }}>
          {model.unresolvedReason ?? "Nothing on the list reached the bar."}
        </p>
        <div style={{ marginTop: 16 }}>
          <Callout tone="warn">Do not open the machine on a guess. The leading suspect below is where the evidence points, not a finding.</Callout>
        </div>
        <Leaders model={model} />
      </Card>
    );
  }

  const waiting = model.status === "waiting";
  const top = model.suspects.filter((s) => s.state === "leading" || s.state === "live").slice(0, 3);
  return (
    <Card tone={waiting ? "warn" : "accent"} title="Verdict" icon={waiting ? <Hourglass size={15} /> : <LoaderCircle size={15} />} actions={<Badge tone="accent">the engine's words</Badge>}>
      <div className="eyebrow">{waiting ? "Not settled yet" : "Investigating"}</div>
      <h3 style={{ fontSize: "1.5rem", fontWeight: 640, letterSpacing: "-0.02em", marginTop: 4 }}>
        {top.length > 1 ? "Too close to call on this reading" : "No suspect has reached the bar"}
      </h3>
      <p className="muted" style={{ marginTop: 10, maxWidth: "80ch" }}>
        {top.length > 1 && (
          <>
            The evidence fits “{fault(top[0].kind).name}” at {pct(top[0].belief)} and “{fault(top[1].kind).name}” at {pct(top[1].belief)}.{" "}
          </>
        )}
        A verdict needs {pct(model.concludeAt)} belief, so Crux names nothing{waiting ? " and asks for the measurement that would separate them." : "."}
      </p>
      <Leaders model={model} />
    </Card>
  );
}

function Leaders({ model }: { model: CaseModel }) {
  const top = model.suspects.slice(0, 3);
  return (
    <div className="leaders">
      {top.map((s, i) => (
        <div className="leader-row" key={s.kind}>
          <span className="truncate">
            <b>{fault(s.kind).name}</b> <span className="dim mono small">{fault(s.kind).technical}</span>
          </span>
          <b className="num" style={{ textAlign: "right" }}>
            {pct(s.belief)}
          </b>
          <Meter value={s.belief ?? 0} mark={model.concludeAt} tone={i === 0 ? "accent" : "neutral"} />
        </div>
      ))}
    </div>
  );
}
