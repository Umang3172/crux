// What is running: the engine, the model each AI job is configured with, the
// limits on an investigation, the measurements the engine can ask for, and the
// API itself. Every value is the server's.

import { useState } from "react";
import { Activity, BookOpen, Bot, ExternalLink, HardDrive, ListChecks, RotateCcw, Ruler, Timer } from "lucide-react";
import { BASE } from "../api/client";
import { AI_JOBS, brainOf } from "../lib/ai";
import { useAbout, useCatalogue, useHealth } from "../lib/hooks";
import { check } from "../lib/plain";
import { resetSession, useSession } from "../lib/session";
import { Badge, Button, Card, ErrorState, Hint, PageHead, SkeletonRows, Stat, Tabs, cx } from "../ui/kit";
import { AiJobs, Limits } from "./trust/Jobs";
import "./pages.css";
import "../styles/trust.css";

const DOCS = [
  { path: "/docs", label: "Try the API" },
  { path: "/redoc", label: "Read the reference" },
  { path: "/openapi.json", label: "Get the schema" },
];

type Tab = "status" | "jobs" | "checks" | "browser";

export default function System() {
  const [tab, setTab] = useState<Tab>("status");
  const health = useHealth();
  const about = useAbout();
  const tests = useCatalogue();
  const session = useSession();
  const jobs = AI_JOBS.filter((j) => j.key !== "gate");
  const live = health.data ? jobs.filter((j) => brainOf(health.data!.models[j.key] as string).live).length : 0;

  return (
    <div className="page tr-page">
      <PageHead title="System" sub="The engine runs without any AI model. Every AI job is optional." />

      <Tabs
        value={tab}
        onChange={setTab}
        label="System"
        tabs={[
          { id: "status", label: "Status" },
          { id: "jobs", label: "AI jobs" },
          { id: "checks", label: "Measurements", count: tests.data?.length },
          { id: "browser", label: "API and this browser" },
        ]}
      />

      {tab === "status" &&
        (health.error ? (
          <Card>
            <ErrorState error={health.error} onRetry={health.reload} />
          </Card>
        ) : (
          <div className="stats">
            <Stat
              label="Engine"
              icon={<Activity size={13} />}
              value={
                <span className="row" style={{ fontSize: "var(--fs-20)" }}>
                  <span className={cx("tr-dot", health.data?.status === "ok" && "live")} aria-hidden />
                  {health.data ? health.data.status : "…"}
                </span>
              }
              sub={BASE ? BASE.replace(/^https?:\/\//, "") : "same origin as this page"}
            />
            <Stat label="AI jobs on a live model" icon={<Bot size={13} />} value={health.data ? live : "…"} unit={`of ${jobs.length}`} sub={live === 0 ? "all on offline stand-ins" : "the rest on offline stand-ins"} />
            <Stat label="Measurements" icon={<Ruler size={13} />} value={tests.data?.length ?? "…"} sub="Crux can ask a person for" />
            <div className="stat">
              <div className="stat-label">
                <Timer size={13} /> Limits per investigation
              </div>
              <div style={{ marginTop: 10 }}>{about.data ? <Limits limits={about.data.limits} /> : <span className="dim">…</span>}</div>
            </div>
          </div>
        ))}

      {tab === "jobs" && (
        <div className="narrow">
          <Card title="AI jobs" icon={<Bot size={15} />} sub="as configured on the server" flush>
            {health.data ? <AiJobs models={health.data.models} raw /> : <SkeletonRows />}
          </Card>
        </div>
      )}

      {tab === "browser" && (
        <div className="narrow col" style={{ gap: "var(--s-5)" }}>
          <Card title="API" icon={<BookOpen size={15} />}>
            <div className="tr-links">
              {DOCS.map((d) => (
                <a key={d.path} href={`${BASE}${d.path}`} target="_blank" rel="noreferrer" className="btn btn-sm" title={d.path}>
                  {d.label} <ExternalLink size={12} aria-hidden />
                </a>
              ))}
            </div>
          </Card>

          <Card
            title="This browser"
            icon={<HardDrive size={15} />}
            actions={<Hint label="Where investigations are kept">The server keeps investigations in memory and shares them, so each browser lists only what it opened. A reset also gives the pump a clean history.</Hint>}
          >
            <dl className="tr-defs" style={{ marginTop: 0 }}>
              <dt>Session</dt>
              <dd className="mono">{session.plant}</dd>
              <dt>Investigations kept</dt>
              <dd>{session.cases.length}</dd>
            </dl>
            <div style={{ marginTop: "var(--s-3)" }}>
              <Button size="sm" icon={<RotateCcw size={13} />} onClick={() => window.confirm("Start a fresh session? This browser forgets its investigations.") && resetSession()}>
                Reset session
              </Button>
            </div>
          </Card>
        </div>
      )}

      {tab === "checks" && (
        <Card title="Measurements Crux can ask for" icon={<ListChecks size={15} />} flush>
          {!tests.data ? (
            <SkeletonRows />
          ) : (
            <div className="table-wrap">
              <table className="table compact t-top">
                <thead>
                  <tr>
                    <th>Measurement</th>
                    <th>
                      <span className="tr-with-hint">
                        Answered by
                        <Hint label="Where each prediction comes from">For a capture, what each suspect predicts is simulated. For a reading a person reports, it comes from a table.</Hint>
                      </span>
                    </th>
                    <th className="t-num">Minutes</th>
                    <th>Downtime</th>
                    <th>Procedure</th>
                  </tr>
                </thead>
                <tbody>
                  {tests.data.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <b>{check(t.id).name}</b>
                        <div className="tiny dim mono">{t.feature}</div>
                      </td>
                      <td>{t.capture_s ? <Badge tone="sim">a {t.capture_s} s capture</Badge> : <Badge tone="warn">a person</Badge>}</td>
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
      )}
    </div>
  );
}
