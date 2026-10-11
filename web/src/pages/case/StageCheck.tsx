import type { Considered, Investigation } from "../../api/types";
import type { CaseEntry } from "../../demo/world";
import type { Fork } from "../../lib/case";
import { weighed } from "../../lib/case";
import { pct, signed } from "../../lib/format";
import { check, CONCLUDE_AT, fault, plainSentence } from "../../lib/plain";
import { Button } from "../../ui/Button";
import { CountUp } from "../../ui/CountUp";
import { Section } from "../../ui/Section";
import { SuspectRack } from "../../ui/SuspectRack";
import { beliefsAt, experimentCount, isCatalogue, rackOrder, requestAt } from "./model";
import { DecidingScale } from "./Signals";
import { Spectra } from "./StageExperiments";
import s from "./Case.module.css";

export function StageCheck({
  inv,
  entry,
  fork,
  evidence,
  onNext,
}: {
  inv: Investigation;
  entry: CaseEntry | undefined;
  fork: Fork;
  evidence: boolean;
  onNext: () => void;
}) {
  const snaps = entry?.snapshots;
  if (fork === "settled") {
    const lead = beliefsAt(inv, snaps, 0).sort((a, b) => b.posterior - a.posterior)[0];
    return (
      <div className={s.stage}>
        <h2 className={s.h2}>The first reading settles it</h2>
        <p className={s.lead}>
          {fault(lead.kind).name} is at {pct(lead.posterior)}, past the {pct(CONCLUDE_AT)} Crux needs. Crux didn't send anyone to measure.
        </p>
        <div className={s.next}>
          <Button kind="primary" size="l" onClick={onNext}>
            See the answer
          </Button>
        </div>
      </div>
    );
  }
  if (fork === "no-cause") return <NoCause inv={inv} considered={inv.no_test?.considered ?? []} />;

  const k = inv.requested_tests.length - 1;
  const req = requestAt(inv, snaps, k) ?? inv.request;
  if (!req) return null;
  const answered = inv.outcomes.length > k;
  const value = answered ? inv.outcomes[k].value : null;
  const before = beliefsAt(inv, snaps, k);
  const now = answered ? beliefsAt(inv, snaps, k + 1) : before;
  const belief = (kind: string) => now.find((b) => b.kind === kind)?.posterior ?? 0;
  const pair = req.separates.slice(0, 2);
  const count = experimentCount(inv);
  const lead = [...now].sort((a, b) => b.posterior - a.posterior)[0];
  const stillOpen = inv.outcome === "open" && inv.requested_tests.length > k + 1;
  const c = check(req.test_id);
  // Where each leader says the check will read; the reading lands on it when it arrives.
  const scale = (
    <DecidingScale
      predictions={pair.map((kind) => ({ name: fault(kind).name, value: req.expected_readings[kind], tone: kind === "healthy" ? "ok" : "attention" }))}
      sigma={req.sigma}
      value={value}
      label={`Where each suspect says the ${c.short} will read${value !== null ? `, and the reading: ${signed(value)}` : ""}`}
    />
  );

  return (
    <div className={s.stage}>
      <h2 className={s.h2}>{answered ? "The reading came back" : "Crux can't tell these two apart."}</h2>
      <div className={s.leaders}>
        {pair.map((kind, i) => (
          <Leader key={kind} kind={kind} belief={belief(kind)} expected={req.expected_readings[kind]} index={i} />
        )).flatMap((el, i) => (i === 0 ? [el, <span key="or" className={s.or}>or</span>] : [el]))}
      </div>
      {answered && scale}
      <SuspectRack
        suspects={now.map((b) => ({ kind: b.kind, label: b.label, origin: b.origin, belief: b.posterior, ruledOut: b.rejected }))}
        order={rackOrder(inv, snaps)}
        leaders={pair}
        caption={`Crux needs ${pct(CONCLUDE_AT)} to name a cause.${count ? ` ${count.captures} virtual experiments run.` : ""}`}
      />
      {answered ? (
        <>
          <p className={s.lead}>
            The {c.short} read <b>{signed(value!)}</b>. That fits <b>{fault(lead.kind).name}</b>, which is now{" "}
            <b>
              <CountUp value={lead.posterior} format={pct} />
            </b>{" "}
            likely.
          </p>
          {stillOpen ? (
            <p className={s.honest}>Still short of {pct(CONCLUDE_AT)}: Crux asks for one more check. The tag on the machine shows it.</p>
          ) : (
            <div className={s.next}>
              <Button kind="primary" size="l" onClick={onNext}>
                See the answer
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className={s.lead}>
            The check that best tells them apart: the {c.short} at {c.where}. Take it here or on a phone, from the tag on the machine.
          </p>
          <CheckMenu considered={req.considered} title="Why this check and not the others" />
          {evidence && scale}
        </>
      )}
      {evidence && entry && isCatalogue(entry.params.fault) && <Spectra inv={inv} entry={entry} kinds={pair} />}
    </div>
  );
}

function Leader({ kind, belief, expected, index }: { kind: string; belief: number; expected: number | undefined; index: number }) {
  const tone = kind === "healthy" ? "var(--ok)" : "var(--attention)";
  return (
    <div className={s.leader} style={{ ["--tone" as string]: tone }}>
      <span className={s.leaderName}>
        {fault(kind).name}
        {index === 1 ? "?" : ""}
      </span>
      <span className={s.leaderPct}>
        <CountUp value={belief} format={pct} />
      </span>
      {expected !== undefined && (
        <span className={s.leaderSays}>
          Says the check will read about <b>{signed(expected)}</b>
        </span>
      )}
    </div>
  );
}

export function CheckMenu({ considered, title }: { considered: Considered[]; title: string }) {
  return (
    <Section title={title} aside="every check Crux weighed">
      <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Check</th>
            <th>Time</th>
            <th>Chance it settles</th>
            <th>Crux's reason</th>
          </tr>
        </thead>
        <tbody>
          {weighed(considered).map((x) => (
            <tr key={x.test_id} className={x.fate === "chosen" ? s.chosen : undefined}>
              <td>
                {check(x.test_id).name} {x.fate === "chosen" && <span className={s.chip}>Chosen</span>}
              </td>
              <td className={s.num}>
                {x.minutes} min{x.downtime !== "none" ? `, ${x.downtime}` : ""}
              </td>
              <td className={s.num}>{x.settle_chance === null ? "–" : x.settle_chance === 0 ? "none" : pct(x.settle_chance)}</td>
              <td>{plainSentence(x.why)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </Section>
  );
}

export function NoCause({ inv, considered }: { inv: Investigation; considered: Considered[] }) {
  return (
    <div className={s.stage}>
      <h2 className={s.h2}>Crux won't name a cause yet</h2>
      {inv.unresolved_reason && <p className={s.lead}>{plainSentence(inv.unresolved_reason)}</p>}
      <p className={s.honest}>Don't open the machine on a guess. Nothing on it is marked, and there is no work order to draft.</p>
      {considered.length > 0 && <CheckMenu considered={considered} title="Every check weighed, and why none could settle it" />}
    </div>
  );
}
