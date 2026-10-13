// Where the investigation stands, in the engine's own words. A language
// model's words never appear here: they are in the report, under its name.

import { Link } from "react-router";
import { CircleCheck, CircleHelp, Hourglass, LoaderCircle } from "lucide-react";
import type { Conclusion, Report } from "../../api/types";
import type { CaseModel } from "../../lib/casemodel";
import { pct } from "../../lib/format";
import { fault, plainSentence } from "../../lib/plain";
import { Badge, Callout, Card, Details, Meter, cx } from "../../ui/kit";
import { Clamp, EngineWords } from "./bits";

const line = (r: Report | null, part: string) => r?.lines.find((l) => l.part === part && l.by === "engine")?.text ?? null;

function Row({ label, children, strong }: { label: string; children: string; strong?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={strong ? "strong" : undefined}>
        <Clamp lines={2}>{children}</Clamp>
      </dd>
    </>
  );
}

export function VerdictCard({ model, conclusion, report, className }: { model: CaseModel; conclusion: Conclusion | null; report: Report | null; className?: string }) {
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
    const flags = [limit && "limit", unseen.length > 0 && "cannot exclude", caveat && "caveat"].filter((x): x is string => !!x);
    return (
      <Card tone="ok" className={cx("vd", className)} title="Verdict" icon={<CircleCheck size={15} />} actions={<EngineWords />}>
        <div className="vd-top">
          <div className="grow">
            <div className="eyebrow">{healthy ? "Nothing to repair" : "Cause named"}</div>
            <h3 className="vd-name">{f.name}</h3>
            <div className="vd-sub">
              <span className="mono">{f.technical}</span>
              {!healthy && <span>{f.partName}</span>}
              {leader.origin === "written" && <Badge tone="model">written by the critic</Badge>}
            </div>
          </div>
          <div className="vd-belief" data-tip={`A verdict needs ${pct(model.concludeAt)}`}>
            <b className="num">{pct(leader.belief)}</b>
            <Meter value={leader.belief ?? 0} mark={model.concludeAt} tone="ok" />
          </div>
        </div>

        {leader.origin === "written" && (
          <Callout tone="model">
            Not on the engine's list. The critic wrote it; the physics simulated and scored it.
            {leader.source && (
              <>
                {" "}
                It cites <b>{leader.source}</b>.
              </>
            )}{" "}
            <Link to="?tab=work">See how</Link>
          </Callout>
        )}

        {(why || action || change) && (
          <dl className="vd-rows">
            {why && <Row label="Why">{plainSentence(why)}</Row>}
            {action && (
              <Row label="What to do" strong>
                {action}
              </Row>
            )}
            {change && <Row label="Would change it">{plainSentence(change)}</Row>}
          </dl>
        )}

        {flags.length > 0 && (
          <Details
            summary={
              <>
                Limits and caveats
                {flags.map((x) => (
                  <Badge key={x} tone="warn">
                    {x}
                  </Badge>
                ))}
              </>
            }
          >
            <dl className="vd-rows">
              {limit && <Row label="Limit">{limit}</Row>}
              {unseen.length > 0 && <Row label="Cannot exclude">{`A mild case of ${unseen.map((s) => fault(s.kind).name.toLowerCase()).join(", ")} would look the same in this evidence.`}</Row>}
              {caveat && <Row label="Caveat">{caveat}</Row>}
            </dl>
          </Details>
        )}
      </Card>
    );
  }

  if (model.status === "unresolved") {
    return (
      <Card className={cx("vd", className)} title="Verdict" icon={<CircleHelp size={15} />} actions={<EngineWords />}>
        <div className="eyebrow">No cause named</div>
        <h3 className="vd-name">Crux will not name a cause on this evidence</h3>
        <Clamp lines={3} className="vd-reason">
          {model.unresolvedReason ?? "Nothing on the list reached the bar."}
        </Clamp>
        <Callout tone="warn">Do not open the machine on a guess.</Callout>
        <Leaders model={model} />
        <p className="vd-note">Where the evidence points. Not a finding.</p>
      </Card>
    );
  }

  const waiting = model.status === "waiting";
  const top = model.suspects.filter((s) => s.state === "leading" || s.state === "live");
  return (
    <Card tone={waiting ? "warn" : "accent"} className={cx("vd", className)} title="Verdict" icon={waiting ? <Hourglass size={15} /> : <LoaderCircle size={15} />}>
      <div className="eyebrow">{waiting ? "Not settled" : "Investigating"}</div>
      <h3 className="vd-name">{top.length > 1 ? "Too close to call" : "No suspect has reached the bar"}</h3>
      <Leaders model={model} />
    </Card>
  );
}

function Leaders({ model }: { model: CaseModel }) {
  return (
    <div className="leaders">
      {model.suspects.slice(0, 3).map((s, i) => (
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
