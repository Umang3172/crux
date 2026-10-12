// What is running: the engine, the model behind each AI job, the measurements
// the engine can ask for, and the API itself.

import { Activity, BookOpen, Bot, ExternalLink, HardDrive, Ruler, RotateCcw } from "lucide-react";
import { BASE } from "../api/client";
import { AI_JOBS, brainOf, fallbackReason } from "../lib/ai";
import { useAbout, useCatalogue, useHealth } from "../lib/hooks";
import { check } from "../lib/plain";
import { resetSession, useSession } from "../lib/session";
import { Badge, Button, Card, ErrorState, PageHead, SkeletonRows, Stat } from "../ui/kit";
import "./pages.css";

const DOCS = [
  { path: "/docs", label: "Interactive API reference", note: "Swagger UI: every route, try it in the browser" },
  { path: "/redoc", label: "API reference, to read", note: "ReDoc" },
  { path: "/openapi.json", label: "OpenAPI schema", note: "the machine-readable contract" },
];

export default function System() {
  const health = useHealth();
  const about = useAbout();
  const tests = useCatalogue();
  const session = useSession();
  const live = health.data ? AI_JOBS.filter((j) => j.key !== "gate" && brainOf(health.data!.models[j.key] as string).live).length : 0;

  return (
    <div className="page">
      <PageHead title="System" sub="The engine is deterministic and runs without any model. Each AI job below is optional: when its model is not live, the job falls back to something that cannot mislead, and says so." />

      {health.error ? (
        <Card>
          <ErrorState error={health.error} onRetry={health.reload} />
        </Card>
      ) : (
        <div className="stats">
          <Stat label="Engine" icon={<Activity size={13} />} value={<span style={{ fontSize: "1.25rem" }}>{health.data ? health.data.status : "…"}</span>} sub={BASE ? `at ${BASE}` : "same origin as this page"} />
          <Stat label="AI jobs on a live model" icon={<Bot size={13} />} value={`${live}/${AI_JOBS.length - 1}`} sub={live === 0 ? "every job is on its fallback" : "the rest are on their fallback"} />
          <Stat label="Measurements in the catalogue" icon={<Ruler size={13} />} value={tests.data?.length ?? "…"} sub="what the engine can ask a person for" />
          <Stat label="Agent tools" value={about.data?.tools.length ?? "…"} sub={about.data ? `${about.data.limits.rounds} rounds, ${about.data.limits.model_calls} model calls, ${about.data.limits.seconds} s per run` : undefined} />
        </div>
      )}

      <div className="grid-2">
        <Card title="AI jobs" icon={<Bot size={15} />} sub="configured, as the server reports it" flush>
          {!health.data ? (
            <SkeletonRows />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Runs on</th>
                </tr>
              </thead>
              <tbody>
                {AI_JOBS.map((j) => {
                  const configured = health.data!.models[j.key] as string;
                  const b = j.key === "gate" ? { name: "rules in code", live: false } : brainOf(configured);
                  const why = fallbackReason(health.data!.models, j.key);
                  return (
                    <tr key={j.key}>
                      <td>
                        <b>{j.label}</b>
                        <div className="small muted">{j.does}</div>
                        {!b.live && j.key !== "gate" && <div className="small dim">Now: {j.instead}</div>}
                        {why && <div className="small t-warn">{why}</div>}
                      </td>
                      <td style={{ verticalAlign: "top" }}>
                        <Badge tone={b.live ? "ok" : "neutral"} dot={b.live}>
                          {b.name}
                        </Badge>
                        <div className="tiny dim mono" style={{ marginTop: 4 }}>
                          {configured}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        <div className="col" style={{ gap: "var(--s-5)" }}>
          <Card title="API" icon={<BookOpen size={15} />} flush>
            <ul className="list">
              {DOCS.map((d) => (
                <li key={d.path}>
                  <a href={`${BASE}${d.path}`} target="_blank" rel="noreferrer" className="row gap-1 strong" style={{ display: "inline-flex" }}>
                    {d.label} <ExternalLink size={13} />
                  </a>
                  <div className="small dim">
                    <span className="mono">{d.path}</span> · {d.note}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="This browser's session" icon={<HardDrive size={15} />}>
            <dl className="defs">
              <dt>Session</dt>
              <dd className="mono">{session.plant}</dd>
              <dt>Cases kept</dt>
              <dd>{session.cases.length}</dd>
              <dt>Where</dt>
              <dd>this browser's local storage</dd>
            </dl>
            <p className="small dim" style={{ margin: "12px 0" }}>
              The server keeps cases in memory and shares them between visitors, so each browser lists only what it opened. A reset also gives the pump a clean history of earlier cases.
            </p>
            <Button icon={<RotateCcw size={14} />} onClick={() => window.confirm("Start a fresh session? This browser forgets its cases.") && resetSession()}>
              Reset session
            </Button>
          </Card>
        </div>
      </div>

      <Card title="Measurements the engine can ask for" icon={<Ruler size={15} />} sub="each with its cost; the engine picks by information per minute" flush>
        {!tests.data ? (
          <SkeletonRows />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Measurement</th>
                  <th>How it is answered</th>
                  <th className="t-num">Minutes</th>
                  <th>Downtime</th>
                  <th>Procedure</th>
                </tr>
              </thead>
              <tbody>
                {tests.data.map((t) => (
                  <tr key={t.id} style={{ verticalAlign: "top" }}>
                    <td>
                      <b>{check(t.id).name}</b>
                      <div className="small dim">{t.name}</div>
                      <div className="tiny dim mono">{t.feature}</div>
                    </td>
                    <td>{t.capture_s ? <Badge tone="sim">a {t.capture_s} s capture; predictions are simulated</Badge> : <Badge tone="warn">a person reports it; predictions come from a table</Badge>}</td>
                    <td className="t-num">{t.effort_min}</td>
                    <td>{t.downtime === "none" ? <span className="dim">none</span> : t.downtime}</td>
                    <td className="muted small">{t.procedure.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
