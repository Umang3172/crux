// The report: the engine's lines, and a language model's sentences under the
// model's own name. Each model sentence was checked against the evidence it
// cites; the ones that failed are shown struck out with the reason.

import { useState } from "react";
import { FileText, FlaskConical, ShieldCheck } from "lucide-react";
import { report as fetchReport } from "../../api/crux";
import type { Report, ReportPart } from "../../api/types";
import { brainOf } from "../../lib/ai";
import { plainSentence } from "../../lib/plain";
import { Badge, Button, Callout, Card, Empty, Hint, SkeletonRows } from "../../ui/kit";
import { EngineWords } from "./bits";

const PART: Record<ReportPart, string> = {
  hazard: "Hazard",
  verdict: "Verdict",
  why: "Why",
  plain: "In plain words",
  limit: "Limit",
  caveat: "Caveat",
  action: "What to do",
  change: "Would change it",
};

function Cites({ ids, onCite }: { ids: string[]; onCite: (ids: string[]) => void }) {
  if (ids.length === 0) return null;
  return (
    <span className="row gap-1 row-wrap" style={{ display: "inline-flex", marginLeft: 6, verticalAlign: "middle" }}>
      {ids.map((id) => (
        <button key={id} type="button" className="chip" onClick={() => onCite(ids)} title="Show it in the evidence ledger">
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
    <div className="col report-removed">
      <div className="row">
        <ShieldCheck size={14} className="t-danger" aria-hidden />
        <h3>Removed by the check</h3>
        <span className="dim small">{r.removed.length} the evidence does not back</span>
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
      actions={
        report && (
          <>
            {report.explained_by ? <Badge tone="model">{writer?.live ? writer.name : report.explained_by}</Badge> : <EngineWords />}
            <Hint label="About the sentence check">Every sentence a language model writes must cite evidence. The check removes any the evidence does not back, and shows why.</Hint>
            <Button size="sm" icon={<FlaskConical size={13} />} busy={busy} onClick={runDemo} disabled={lost}>
              Test the check
            </Button>
          </>
        )
      }
      foot={report && !report.explained_by ? "No language model is on: these are the engine's sentences only." : undefined}
    >
      {loading && !report ? (
        <SkeletonRows rows={4} />
      ) : !report ? (
        <Empty left title={lost ? "Not on the server any more" : "The report could not be read"} />
      ) : (
        <>
          <Lines r={report} onCite={onCite} />
          {report.revisions > 0 && (
            <p className="small dim report-rev">
              Sent back {report.revisions} time{report.revisions > 1 ? "s" : ""} to rewrite · {report.first_removed} sentence{report.first_removed === 1 ? "" : "s"} failed the first check
            </p>
          )}
          <Removed r={report} />
        </>
      )}

      {error && (
        <div style={{ marginTop: 12 }}>
          <Callout tone="danger">{error}</Callout>
        </div>
      )}

      {demo && (
        <div className="report-demo">
          <div className="row row-wrap">
            <h3>The check at work</h3>
            <Badge tone="warn">demonstration</Badge>
            <Badge tone="model">{demo.explained_by || "a test writer"}</Badge>
          </div>
          <p className="small muted">Not part of this investigation: a writer told to make false claims got the same evidence.</p>
          <Lines r={{ ...demo, lines: demo.lines.filter((l) => l.by !== "engine") }} onCite={onCite} />
          <Removed r={demo} />
        </div>
      )}
    </Card>
  );
}
