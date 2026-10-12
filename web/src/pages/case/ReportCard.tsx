// The report: the engine's lines, and a language model's sentences under the
// model's own name. Each model sentence was checked against the evidence it
// cites; the ones that failed are shown struck out with the reason.

import { useState } from "react";
import { FileText, FlaskConical, ShieldCheck } from "lucide-react";
import { report as fetchReport } from "../../api/crux";
import type { Report, ReportPart } from "../../api/types";
import { brainOf } from "../../lib/ai";
import { plainSentence } from "../../lib/plain";
import { Badge, Button, Callout, Card, Empty, SkeletonRows } from "../../ui/kit";

const PART: Record<ReportPart, string> = {
  hazard: "Hazard",
  verdict: "Verdict",
  why: "Why",
  plain: "In plain words",
  limit: "Limit",
  caveat: "Caveat",
  action: "What to do",
  change: "Would change this",
};

function Cites({ ids, onCite }: { ids: string[]; onCite: (ids: string[]) => void }) {
  if (ids.length === 0) return null;
  return (
    <span className="row gap-1 row-wrap" style={{ display: "inline-flex", marginLeft: 6, verticalAlign: "middle" }}>
      {ids.map((id) => (
        <button key={id} type="button" className="chip" onClick={() => onCite(ids)} title="Show this entry in the ledger">
          {id}
        </button>
      ))}
    </span>
  );
}

function Lines({ r, onCite }: { r: Report; onCite: (ids: string[]) => void }) {
  return (
    <div>
      {r.lines.map((l, i) => {
        const model = l.by !== "engine";
        return (
          <div key={i} className={model ? "report-line model" : "report-line"}>
            <div className="report-part">
              {PART[l.part] ?? l.part}
              {model && <div className="t-model tiny">written by {brainOf(l.by).live ? brainOf(l.by).name : l.by}</div>}
            </div>
            <div>
              {l.part === "hazard" ? <b className="t-danger">{l.text}</b> : plainSentence(l.text)}
              <Cites ids={l.cites} onCite={onCite} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Removed({ r }: { r: Report }) {
  if (r.removed.length === 0) return null;
  return (
    <div className="col" style={{ marginTop: 14 }}>
      <div className="row">
        <ShieldCheck size={14} className="t-danger" aria-hidden />
        <h3>Removed by the check</h3>
        <span className="dim small">
          {r.removed.length} sentence{r.removed.length > 1 ? "s" : ""} the evidence does not back
        </span>
      </div>
      {r.removed.map((x, i) => (
        <div className="removed" key={i}>
          <s>{x.text}</s>
          <span>Removed: {x.why}.</span>
        </div>
      ))}
    </div>
  );
}

export function ReportCard({ caseId, report, loading, lost, onCite }: { caseId: string; report: Report | null; loading: boolean; lost: boolean; onCite: (ids: string[]) => void }) {
  const [demo, setDemo] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runDemo() {
    setBusy(true);
    setError(null);
    try {
      setDemo(await fetchReport(caseId, "careless"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const writer = report?.explained_by ? brainOf(report.explained_by) : null;

  return (
    <Card
      title="Report"
      icon={<FileText size={15} />}
      sub={report ? (report.explained_by ? `explained by ${writer?.live ? writer.name : report.explained_by}` : "engine only") : undefined}
      actions={
        report && (
          <Button size="sm" icon={<FlaskConical size={13} />} busy={busy} onClick={runDemo} disabled={lost}>
            Test the sentence check
          </Button>
        )
      }
    >
      {loading && !report ? (
        <SkeletonRows rows={4} />
      ) : !report ? (
        <Empty left title="No report on this server">
          {lost ? "The server restarted and no longer holds this case, so it cannot write the report again." : "The report could not be read."}
        </Empty>
      ) : (
        <>
          <Lines r={report} onCite={onCite} />
          {report.revisions > 0 && (
            <p className="small dim" style={{ marginTop: 10 }}>
              The model was sent back {report.revisions} time{report.revisions > 1 ? "s" : ""} to rewrite; {report.first_removed} sentence{report.first_removed === 1 ? "" : "s"} failed the check on the first draft.
            </p>
          )}
          <Removed r={report} />
          {!report.explained_by && (
            <p className="small dim" style={{ marginTop: 12 }}>
              No language model is on for explanations, so the engine's sentences are the whole report. When one is, each of its sentences must cite evidence and is checked before it is shown.
            </p>
          )}
        </>
      )}

      {error && (
        <div style={{ marginTop: 12 }}>
          <Callout tone="danger">{error}</Callout>
        </div>
      )}

      {demo && (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
          <div className="row row-wrap" style={{ marginBottom: 8 }}>
            <h3>The check at work</h3>
            <Badge tone="model">{demo.explained_by || "a test writer"}</Badge>
          </div>
          <p className="small muted" style={{ marginBottom: 10 }}>
            This is a demonstration, not part of the case: a writer that makes false claims on purpose was given the same evidence. What survived and what was thrown out is below.
          </p>
          <Lines r={{ ...demo, lines: demo.lines.filter((l) => l.by !== "engine") }} onCite={onCite} />
          <Removed r={demo} />
        </div>
      )}
    </Card>
  );
}
