/**
 * A case's result in words, with the evidence each line rests on.
 *
 * Two voices, shown apart. The engine's lines are the result. A model's
 * sentences, when one is on, are an explanation: each was kept on the server
 * only if every number and every named cause in it is in the evidence it cites.
 * The sentences that failed are listed with the reason, not hidden.
 *
 * "See the check at work" runs a test writer that makes false claims on
 * purpose, so the check can be watched removing them.
 */

import { useEffect, useState } from "react";
import { CaseReport, Part, ReportLine, caseReport } from "./api";
import "./report.css";

const HEADINGS: Partial<Record<Part, string>> = {
  hazard: "Hazard reported",
  why: "Why",
  limit: "What this could not have seen",
  action: "What to do",
  change: "What would change it",
};

type Props = {
  id: string;
  /** Which parts to show. A view that already shows the verdict leaves it out. */
  parts?: Part[];
  /** Rewords the engine's lines for a non-engineer. A model's sentences are left as written. */
  plain?: (sentence: string) => string;
};

function Cites({ line, report }: { line: ReportLine; report: CaseReport }) {
  const [open, setOpen] = useState(false);
  if (line.cites.length === 0) return null;
  const cited = report.evidence.filter((e) => line.cites.includes(e.id));
  return (
    <>
      <button
        className="r-cites"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title="Show the evidence this rests on"
      >
        {line.cites.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </button>
      {open && (
        <ul className="r-evidence">
          {cited.map((e) => (
            <li key={e.id}>
              <b>{e.id}</b> {e.statement} <em>{e.kind.replace(/_/g, " ")}</em>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Removed({ report }: { report: CaseReport }) {
  if (report.removed.length === 0) return null;
  return (
    <div className="r-removed">
      <b>
        Removed by the check ({report.removed.length}): the evidence cited did not back{" "}
        {report.removed.length === 1 ? "it" : "them"}
      </b>
      <ul>
        {report.removed.map((r, i) => (
          <li key={i}>
            <s>{r.text}</s>
            <span>Removed because {r.why}.</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CaseReportPanel({ id, parts, plain }: Props) {
  // The engine's lines come back at once; a model's explanation can take seconds.
  const [own, setOwn] = useState<CaseReport | null>(null);
  const [full, setFull] = useState<CaseReport | null>(null);
  const [demo, setDemo] = useState<CaseReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stale = false;
    setOwn(null);
    setFull(null);
    setDemo(null);
    setFailed(false);
    caseReport(id, "engine")
      .then((r) => !stale && setOwn(r))
      .catch(() => !stale && setFailed(true));
    caseReport(id)
      .then((r) => !stale && setFull(r))
      .catch(() => !stale && setFailed(true));
    return () => {
      stale = true;
    };
  }, [id]);

  const report = full ?? own;
  if (!report) {
    return failed ? null : <p className="g-muted r-wait">Writing up the result…</p>;
  }

  const shown = report.lines.filter((l) => !parts || parts.includes(l.part));
  const engine = shown.filter((l) => l.by === "engine");
  const written = shown.filter((l) => l.by !== "engine");
  const first = ["hazard", "verdict", "why"];
  const before = engine.filter((l) => first.includes(l.part));
  const after = engine.filter((l) => !first.includes(l.part));
  const reword = plain ?? ((s: string) => s);

  const showCheck = async () => {
    setBusy(true);
    try {
      setDemo(await caseReport(id, "careless"));
    } catch {
      setDemo(null);
    } finally {
      setBusy(false);
    }
  };

  const engineLine = (l: ReportLine) => (
    <div className={`r-line ${l.part}`} key={l.part}>
      {HEADINGS[l.part] && <span className="r-head">{HEADINGS[l.part]}</span>}
      <p>
        {reword(l.text)} <Cites line={l} report={report} />
      </p>
    </div>
  );

  return (
    <section className="r-report" aria-label="The result in words">
      {before.map(engineLine)}

      {written.length > 0 && (
        <div className="r-model">
          <span className="r-head">In plain words, written by {report.explained_by}</span>
          {written.map((l, i) => (
            <p key={i}>
              {l.text} <Cites line={l} report={report} />
            </p>
          ))}
        </div>
      )}

      {after.map(engineLine)}

      {!full && !failed && <p className="g-muted r-wait">Asking for an explanation…</p>}

      {report.explained_by && (
        <p className="r-note">
          Every other line above is the engine's own. A sentence from {report.explained_by} was
          kept only if every number and every named cause in it is in the evidence it cites.
          The check cannot tell whether the wording is a fair reading, which is why the verdict
          and the action are never written by a model.
        </p>
      )}
      {full?.notes.map((n, i) => (
        <p className="r-note" key={i}>
          {n}
        </p>
      ))}
      <Removed report={report} />

      {report.outcome === "concluded" && (
        <div className="r-demo">
          {!demo ? (
            <button className="r-try" onClick={() => void showCheck()} disabled={busy}>
              {busy ? "Running…" : "See the check at work"}
            </button>
          ) : (
            <>
              <span className="r-head">The check at work</span>
              <p className="r-note">
                A test writer made these claims about this case on purpose: one true, the rest
                false. This is what the check did with them.
              </p>
              <ul className="r-kept">
                {demo.lines
                  .filter((l) => l.by !== "engine")
                  .map((l, i) => (
                    <li key={i}>
                      {l.text} <Cites line={l} report={demo} />
                      <span>Kept: its figure is in the entry it cites.</span>
                    </li>
                  ))}
              </ul>
              <Removed report={demo} />
              <button className="r-try" onClick={() => setDemo(null)}>
                Hide
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
