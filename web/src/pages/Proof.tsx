// The measured results. Every figure comes from data/evaluation.ts, which
// holds what the project's own evaluation runs printed. The page opens on the
// scoreboard: each job's method beside the ones it beat. Nothing is computed
// here beyond adding its parts and the differences the page has always shown;
// the small pictures draw those same counts, one square each.

import { useState } from "react";
import { CircleSlash, ExternalLink, FlaskConical, ScrollText, Terminal, TriangleAlert } from "lucide-react";
import { ASKED, BEST, BY_FAULT, COMMAND, CRUX, CRUX_RIGHT, PER_FAULT, RECORDINGS, REPO, TOTAL, WHERE_BEST_WRONG } from "../data/evaluation";
import { CONCLUDE_AT, fault } from "../lib/plain";
import { pct } from "../lib/format";
import { Badge, Card, CountUp, Details, Hint, PageHead, SourceTag, Tabs } from "../ui/kit";
import { Scoreboard } from "./trust/Scoreboard";
import { UnitChart, type UnitPart } from "./trust/UnitChart";
import { useSeenOnce } from "./trust/seen";
import "./pages.css";
import "../styles/trust.css";

function Result() {
  const [ref, on] = useSeenOnce<HTMLDivElement>(0.2);
  const crux: UnitPart[] = [
    { id: "alone", label: "right, no measurement", count: CRUX.alone, tone: "ok" },
    { id: "after", label: "right after a measurement", count: CRUX.afterCheck, tone: "accent" },
    { id: "declined", label: "declined", count: CRUX.cantTell, tone: "declined" },
    { id: "wrong", label: "wrong", count: CRUX.wrong, tone: "danger" },
  ];
  const best: UnitPart[] = [
    { id: "right", label: "right", count: BEST.right, tone: "ok" },
    { id: "wrong", label: "wrong", count: BEST.wrong, tone: "danger" },
  ];

  return (
    <Card id="result" title={`${TOTAL} hard tests`} icon={<FlaskConical size={15} />} actions={<SourceTag source="synthetic cases" />}>
      <div ref={ref}>
        <p className="tr-caveat">
          <TriangleAlert size={15} aria-hidden />
          <span className="grow">
            All {TOTAL} are synthetic, made by the same signal model Crux simulates with. They test the decision rule, not the fit to a real machine.
          </span>
          <Hint label="How the cases were made">
            Three faults at three strengths under four noise levels, five seeds each. When Crux asks for a measurement, a new capture of the same synthetic machine answers it.
          </Hint>
        </p>

        <div className="tr-duel">
          <section className="tr-panel" aria-label="Crux">
            <div className="tr-panel-head">
              <h3>Crux</h3>
              <Badge tone="accent">may decline</Badge>
              <Hint label="How Crux decides">
                It names a cause only at {pct(CONCLUDE_AT)} belief. Short of that it asks for a measurement, and declines if the measurements still cannot settle it. Every case it declined had asked first.
              </Hint>
            </div>
            <div className="tr-big">
              <b className="t-ok">{CRUX.wrong}</b>
              <span>
                <b>wrong</b>
                <br />
                of the {CRUX_RIGHT} it named
              </span>
            </div>
            <UnitChart parts={crux} on={on} label={`Crux on ${TOTAL} synthetic cases`} />
          </section>

          <section className="tr-panel" aria-label="Best spectral match">
            <div className="tr-panel-head">
              <h3>Best spectral match</h3>
              <Badge>always answers</Badge>
              <Hint label="What the best spectral match is">The simplest rule that always answers: name the fault whose simulated spectrum matches the reading best.</Hint>
            </div>
            <div className="tr-big">
              <b className="t-danger">
                <CountUp value={on ? BEST.wrong : 0} ms={1000} />
              </b>
              <span>
                <b>wrong</b>
                <br />
                of the {TOTAL}
              </span>
            </div>
            <UnitChart parts={best} on={on} lag={120} label={`Best spectral match on ${TOTAL} synthetic cases`} />
          </section>
        </div>

        <div className="tr-trade">
          <span>
            Crux: <b>{BEST.right - CRUX_RIGHT} fewer</b> right answers, <b>{BEST.wrong - CRUX.wrong} fewer</b> wrong ones.
          </span>
          <Hint label="Where the best match was wrong">
            In the {BEST.wrong} cases where the best match named the wrong fault, Crux declined {WHERE_BEST_WRONG.cantTell} times and named the right cause {WHERE_BEST_WRONG.right} times.
          </Hint>
        </div>

        <div style={{ marginTop: "var(--s-3)" }}>
          <Details summary={`By fault, ${PER_FAULT} each`}>
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>True fault</th>
                    <th className="t-num">Right</th>
                    <th className="t-num">Declined</th>
                    <th className="t-num">Wrong</th>
                    <th className="t-num" data-tip="Crux asked for a measurement">
                      Asked
                    </th>
                    <th className="t-num" data-tip="How many the best spectral match got right">
                      Best match
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {BY_FAULT.map((r) => (
                    <tr key={r.fault}>
                      <td className="strong">{fault(r.fault).name}</td>
                      <td className="t-num">{r.right}</td>
                      <td className="t-num">{r.cantTell}</td>
                      <td className="t-num">{r.wrong}</td>
                      <td className="t-num">{r.asked}</td>
                      <td className="t-num dim-cell">
                        {r.bestRight} of {PER_FAULT}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="strong">All</td>
                    <td className="t-num strong">{CRUX_RIGHT}</td>
                    <td className="t-num strong">{CRUX.cantTell}</td>
                    <td className="t-num strong">{CRUX.wrong}</td>
                    <td className="t-num strong">{ASKED}</td>
                    <td className="t-num dim-cell">
                      {BEST.right} of {TOTAL}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Details>
        </div>
      </div>
    </Card>
  );
}

type Tab = "bench" | "tests" | "real" | "limits";

export default function Proof() {
  const [tab, setTab] = useState<Tab>("bench");
  return (
    <div className="page tr-page">
      <PageHead title="Track record" sub="Every method Crux runs, beside the ones it was tested against." />

      <Tabs
        value={tab}
        onChange={setTab}
        label="Track record"
        tabs={[
          { id: "bench", label: "Benchmarks" },
          { id: "tests", label: "Hard tests" },
          { id: "real", label: "Real recordings" },
          { id: "limits", label: "What it does not claim" },
        ]}
      />

      {tab === "bench" && <Scoreboard />}

      {tab === "tests" && <Result />}

      <div className="narrow col" style={{ gap: "var(--s-5)" }}>
        {tab === "real" && (
          <Card title="Real recordings" icon={<ScrollText size={15} />} flush>
            <p className="tr-lead">No figure yet for naming a fault on real recordings. Alarms and time left are on the Benchmarks tab.</p>
            <ul className="tr-sets">
              {RECORDINGS.map((r) => (
                <li key={r.dataset}>
                  <div>
                    <b>{r.dataset}</b>
                    <div className="small dim">{r.kind}</div>
                  </div>
                  <div>
                    <span>{r.run}</span> <b>{r.result}</b>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {tab === "limits" && (
          <Card title="What Crux does not claim" icon={<CircleSlash size={15} />} flush>
            <ul className="tr-claims">
              <li>
                <CircleSlash size={14} aria-hidden />
                <div>
                  <b>Accuracy on real machines.</b> <span>The {TOTAL} cases are synthetic.</span>
                </div>
              </li>
              <li>
                <CircleSlash size={14} aria-hidden />
                <div>
                  <b>That a forecast is a promise.</b> <span>It is a range for planning.</span>
                </div>
              </li>
              <li>
                <CircleSlash size={14} aria-hidden />
                <div>
                  <b>That what a camera or a model saw is confirmed.</b> <span>Unconfirmed until a person checks it.</span>
                </div>
              </li>
              <li>
                <CircleSlash size={14} aria-hidden />
                <div>
                  <b>That it can act on a machine.</b> <span>Crux recommends; a person decides and does the work.</span>
                </div>
              </li>
            </ul>
          </Card>
        )}

        {tab === "limits" && (
          <Card title="Try it yourself" icon={<Terminal size={15} />}>
            <div className="tr-run">
              <code className="code-block">{COMMAND}</code>
              <Hint label="What it runs">
                The same {TOTAL} cases, offline and with no keys. It prints the totals and the table by fault.
              </Hint>
              <a href={REPO} target="_blank" rel="noreferrer" className="btn">
                Open the code <ExternalLink size={13} aria-hidden />
              </a>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
