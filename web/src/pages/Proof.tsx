// The measured results. Every figure comes from data/evaluation.ts, which
// holds what the project's own evaluation run printed; none is computed here
// beyond adding its parts.

import { CircleSlash, ExternalLink, FlaskConical, ShieldCheck, Terminal } from "lucide-react";
import { ASKED, BEST, BY_FAULT, COMMAND, CRUX, CRUX_RIGHT, MEASURED, PER_FAULT, RECORDINGS, REPO, TOTAL, WHERE_BEST_WRONG } from "../data/evaluation";
import { fault } from "../lib/plain";
import { StackBar } from "../ui/charts";
import { Badge, Callout, Card, PageHead, SourceTag, Stat } from "../ui/kit";
import "./pages.css";

export default function Proof() {
  return (
    <div className="page">
      <PageHead
        title="Track record"
        sub={`On ${TOTAL} hard synthetic cases Crux named a wrong cause ${CRUX.wrong} times and said “can't tell” ${CRUX.cantTell} times. A system that is allowed to decline is judged in this order: how often it answers alone, how often it needs a measurement, how often it declines, and only last how often it is wrong.`}
        actions={<SourceTag source="synthetic cases" />}
      />

      <Callout tone="warn">
        These cases are synthetic: made by the same signal model Crux simulates with. They test the decision rule, not how well the model fits a real machine. No accuracy figure on real recordings exists yet, and none is shown.
      </Callout>

      <div className="stats">
        <Stat label="Solved by simulation alone" value={CRUX.alone} unit={`of ${TOTAL}`} sub="no measurement asked for; every one right" />
        <Stat label="Needed one measurement" value={CRUX.afterCheck} unit={`of ${TOTAL}`} sub="asked, then named the right cause" />
        <Stat label="Declined to answer" value={CRUX.cantTell} unit={`of ${TOTAL}`} sub="asked for measurements and still could not tell" />
        <Stat label="Wrong" value={CRUX.wrong} unit={`of ${CRUX_RIGHT} named`} sub="a cause is named only at 80% belief" />
      </div>

      <Card title="Against always answering" icon={<ShieldCheck size={15} />} sub="the same 180 cases, two ways of deciding">
        <div className="score">
          <div>
            <div className="row row-wrap">
              <h3 style={{ fontSize: "var(--fs-16)" }}>Crux</h3>
              <Badge tone="accent">may decline</Badge>
            </div>
            <div className="row" style={{ alignItems: "baseline", marginTop: 10, gap: 12 }}>
              <span className="score-big t-ok">{CRUX.wrong}</span>
              <span className="muted">
                wrong answers
                <br />
                of the {CRUX_RIGHT} it named
              </span>
            </div>
            <div style={{ marginTop: 16 }}>
              <StackBar
                height={12}
                parts={[
                  { label: "Right, no measurement", value: CRUX.alone, tone: "ok" },
                  { label: "Right after a measurement", value: CRUX.afterCheck, tone: "accent" },
                  { label: "Declined", value: CRUX.cantTell, tone: "muted" },
                ]}
              />
            </div>
            <div className="chart-legend">
              <span className="chart-key">
                <i style={{ background: "var(--ok)" }} />
                right, alone <b className="num">{CRUX.alone}</b>
              </span>
              <span className="chart-key">
                <i style={{ background: "var(--accent)" }} />
                right after a measurement <b className="num">{CRUX.afterCheck}</b>
              </span>
              <span className="chart-key">
                <i style={{ background: "var(--text-3)" }} />
                declined <b className="num">{CRUX.cantTell}</b>
              </span>
            </div>
          </div>
          <div>
            <div className="row row-wrap">
              <h3 style={{ fontSize: "var(--fs-16)" }}>Naming the best spectral match</h3>
              <Badge>always answers</Badge>
            </div>
            <div className="row" style={{ alignItems: "baseline", marginTop: 10, gap: 12 }}>
              <span className="score-big t-danger">{BEST.wrong}</span>
              <span className="muted">
                wrong answers
                <br />
                of the {TOTAL}
              </span>
            </div>
            <div style={{ marginTop: 16 }}>
              <StackBar
                height={12}
                parts={[
                  { label: "Right", value: BEST.right, tone: "ok" },
                  { label: "Wrong", value: BEST.wrong, tone: "danger" },
                ]}
              />
            </div>
            <div className="chart-legend">
              <span className="chart-key">
                <i style={{ background: "var(--ok)" }} />
                right <b className="num">{BEST.right}</b>
              </span>
              <span className="chart-key">
                <i style={{ background: "var(--danger)" }} />
                wrong <b className="num">{BEST.wrong}</b>
              </span>
            </div>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 18, maxWidth: "96ch" }}>
          Crux ends with {BEST.right - CRUX_RIGHT} fewer right answers ({CRUX_RIGHT} against {BEST.right}) and {BEST.wrong - CRUX.wrong} fewer wrong ones. In the {BEST.wrong} cases where the best match named the wrong fault, Crux declined {WHERE_BEST_WRONG.cantTell} times and named the right cause {WHERE_BEST_WRONG.right} times. It asked for a measurement in {ASKED} of the {TOTAL}.
        </p>
      </Card>

      <div className="grid-2">
        <Card title="By the fault that was fed in" icon={<FlaskConical size={15} />} sub={`${PER_FAULT} cases each`} flush>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>True fault</th>
                  <th className="t-num">Right</th>
                  <th className="t-num">Declined</th>
                  <th className="t-num">Wrong</th>
                  <th className="t-num" data-tip="Cases where Crux asked for a measurement">
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
        </Card>

        <Card title="What Crux does not claim" icon={<CircleSlash size={15} />}>
          <ul className="col gap-3">
            <li>
              <b>That it is accurate on real machines.</b> <span className="muted">The {TOTAL} cases are synthetic. The loader and benchmark for real bearing recordings exist; no result from them is shown until they have been run.</span>
            </li>
            <li>
              <b>That a forecast is a promise.</b> <span className="muted">Time left is a range for planning. The machine pages show it with its own caution from the server.</span>
            </li>
            <li>
              <b>That what a camera or a model saw is confirmed.</b> <span className="muted">It stays marked unconfirmed until a person checks it.</span>
            </li>
            <li>
              <b>That it can act on a machine.</b> <span className="muted">Crux recommends. A person decides and does the work.</span>
            </li>
          </ul>
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Other measured results" icon={<FlaskConical size={15} />} flush>
          <ul className="list">
            {MEASURED.map((m) => (
              <li key={m.key} style={{ display: "grid", gridTemplateColumns: "92px minmax(0, 1fr)", gap: 16 }}>
                <div>
                  <div className="num" style={{ fontSize: "1.75rem", fontWeight: 640, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
                    {m.figure}
                  </div>
                  <div className="small dim">{m.of}</div>
                </div>
                <div>
                  <p className="muted">{m.what}</p>
                  <div style={{ marginTop: 6 }}>
                    <SourceTag source={m.source} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Real recordings" icon={<ShieldCheck size={15} />} sub="where each dataset stands" flush>
          <table className="table">
            <thead>
              <tr>
                <th>Dataset</th>
                <th>What has been run</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {RECORDINGS.map((r) => (
                <tr key={r.dataset} style={{ verticalAlign: "top" }}>
                  <td>
                    <b>{r.dataset}</b>
                    <div className="small dim">{r.kind}</div>
                  </td>
                  <td className="muted">{r.run}</td>
                  <td>{r.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="Run it yourself" icon={<Terminal size={15} />}>
        <p className="muted">The same {TOTAL} cases, offline, with no keys: three faults at three strengths under four noise levels, five seeds each. It prints the totals and the table by fault.</p>
        <div className="code-block" style={{ marginTop: 10 }}>
          {COMMAND}
        </div>
        <p style={{ marginTop: 12 }}>
          <a href={REPO} target="_blank" rel="noreferrer" className="row gap-1" style={{ display: "inline-flex" }}>
            The code and its notes <ExternalLink size={13} />
          </a>
        </p>
      </Card>
    </div>
  );
}
