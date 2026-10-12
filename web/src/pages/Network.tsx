// Learning across sites: this site's forecasting model, an update waiting to
// be tested and installed, and the lessons earlier repairs left behind.

import { useState } from "react";
import { BookOpen, Download, Network as NetworkIcon, RotateCcw, ShieldCheck } from "lucide-react";
import { fleetApprove, fleetPull, fleetRollback, fleetStatus, lessons as fetchLessons } from "../api/crux";
import { num, pct, stamp } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { Badge, Button, Callout, Card, Empty, ErrorState, PageHead, SkeletonRows, Stat } from "../ui/kit";
import "./pages.css";

export default function Network() {
  const status = useAsync(() => fleetStatus(), []);
  const [q, setQ] = useState("");
  const lessons = useAsync(() => fetchLessons("rolling bearing", q, 20), [q]);
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  async function act(name: string, fn: () => Promise<string>) {
    setBusy(name);
    setMessage(null);
    try {
      setMessage({ tone: "ok", text: await fn() });
      status.reload();
      lessons.reload();
    } catch (e) {
      setMessage({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const s = status.data;
  const hasHub = (s?.hub_versions.length ?? 0) > 0;

  return (
    <div className="page">
      <PageHead title="Network" sub="What one site learns can help the next. An update from other sites is tested on this site's own past failures first, and a person decides whether to install it. Nothing installs itself." />

      {status.error ? (
        <Card>
          <ErrorState error={status.error} onRetry={status.reload} />
        </Card>
      ) : !s ? (
        <Card>
          <SkeletonRows />
        </Card>
      ) : (
        <>
          <div className="stats">
            <Stat label="This site" value={<span style={{ fontSize: "1.25rem" }}>{s.site}</span>} sub={`forecasting model: ${s.model}`} />
            <Stat label="Installed update" value={s.active === null ? "none" : `v${s.active}`} sub={s.active === null ? "running on its own model" : "installed by a person"} />
            <Stat label="Waiting for a decision" value={s.staged ? `v${s.staged.version}` : "none"} sub={s.staged ? (s.staged.report.passes ? "passed this site's test" : "did not pass this site's test") : "nothing is staged"} />
            <Stat label="Lessons on file" value={s.lessons} sub="from repairs that were recorded" />
          </div>

          {!hasHub && (
            <Callout tone="warn">
              No hub is connected to this server, so there is no other site to pull an update from. The page shows what this site holds; the controls below work once a hub is configured.
            </Callout>
          )}

          <div className="grid-2">
            <Card title="Updates from other sites" icon={<Download size={15} />}>
              {s.staged ? (
                <div className="col gap-3">
                  <div className="row row-wrap">
                    <h3 style={{ fontSize: "var(--fs-16)" }}>Version {s.staged.version}</h3>
                    <Badge tone={s.staged.report.passes ? "ok" : "danger"} dot>
                      {s.staged.report.passes ? "passed on this site's own failures" : "failed on this site's own failures"}
                    </Badge>
                  </div>
                  <p className="muted">{s.staged.report.reason}</p>
                  {s.staged.report.current && s.staged.report.candidate && (
                    <table className="table compact">
                      <thead>
                        <tr>
                          <th>Model</th>
                          <th className="t-num" data-tip="Typical miss of the most-likely estimate, as a share of the time that was left">
                            Error
                          </th>
                          <th className="t-num" data-tip="How often the whole range fell after the real failure">
                            Too late
                          </th>
                          <th className="t-num">Truth inside the range</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { label: "Installed now", r: s.staged.report.current },
                          { label: "The update", r: s.staged.report.candidate },
                        ].map(({ label, r }) => (
                          <tr key={label}>
                            <td>
                              <b>{label}</b> <span className="dim mono small">{r.model}</span>
                            </td>
                            <td className="t-num">{r.error === null ? "–" : num(r.error, 2)}</td>
                            <td className="t-num">{r.late === null ? "–" : pct(r.late)}</td>
                            <td className="t-num">{r.inside === null ? "–" : pct(r.inside)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : (
                <Empty left title="Nothing is waiting">
                  Pull to ask the hub for a newer version. It is tested here before anyone is asked to install it.
                </Empty>
              )}
              <div className="row row-wrap" style={{ marginTop: 16 }}>
                <Button icon={<Download size={14} />} busy={busy === "pull"} disabled={!hasHub || busy !== null} onClick={() => act("pull", async () => {
                  const r = await fleetPull();
                  return `Pulled. ${r.alerts.length} alert${r.alerts.length === 1 ? "" : "s"}, ${r.rejected.length} version${r.rejected.length === 1 ? "" : "s"} rejected${r.staged ? ", one staged for a decision" : ""}.`;
                })}>
                  Pull from the hub
                </Button>
                <input className="input" style={{ width: 150 }} placeholder="Your name" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Your name" />
                <Button variant="primary" icon={<ShieldCheck size={14} />} busy={busy === "approve"} disabled={!s.staged || !by.trim() || busy !== null} onClick={() => act("approve", async () => {
                  const r = await fleetApprove(by.trim());
                  return `Installed version ${r.active}. ${r.lessons_added} lesson${r.lessons_added === 1 ? "" : "s"} added.`;
                })}>
                  Install
                </Button>
                <Button variant="ghost" icon={<RotateCcw size={14} />} busy={busy === "rollback"} disabled={s.active === null || !by.trim() || busy !== null} onClick={() => act("rollback", async () => `Rolled back to version ${(await fleetRollback(by.trim())).active}.`)}>
                  Roll back
                </Button>
              </div>
              {message && (
                <div style={{ marginTop: 12 }}>
                  <Callout tone={message.tone}>{message.text}</Callout>
                </div>
              )}
            </Card>

            <Card title="Decisions at this site" icon={<NetworkIcon size={15} />} flush>
              {s.history.length === 0 ? (
                <Empty left title="No update has been installed or rolled back">
                  Each decision is recorded with the name of the person who made it.
                </Empty>
              ) : (
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Version</th>
                      <th>Decided by</th>
                      <th>Replaced</th>
                      <th className="t-num">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.history.map((h, i) => (
                      <tr key={i}>
                        <td className="mono">{h.version === null ? "own model" : `v${h.version}`}</td>
                        <td>{h.approved_by}</td>
                        <td className="mono dim-cell">{h.previous === null ? "own model" : `v${h.previous}`}</td>
                        <td className="t-num dim-cell">{stamp(h.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}

      <Card
        title="Lessons"
        icon={<BookOpen size={15} />}
        sub="what repairs found, for the next case on a machine like it"
        flush
        actions={<input className="input input-sm" style={{ width: 220 }} placeholder="Search lessons" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search lessons" />}
      >
        {lessons.error ? (
          <ErrorState error={lessons.error} onRetry={lessons.reload} />
        ) : !lessons.data ? (
          <SkeletonRows />
        ) : lessons.data.length === 0 ? (
          <Empty left icon={<BookOpen size={18} />} title={q ? "No lesson matches" : "No lesson on file yet"}>
            A lesson is written when someone records what a repair found, on an approved work order.
          </Empty>
        ) : (
          <ul className="list">
            {lessons.data.map((l) => (
              <li key={l.id}>
                <div className="row row-wrap">
                  <b>{l.title}</b>
                  <Badge tone={l.outcome === "success" ? "ok" : "warn"}>{l.outcome === "success" ? "Crux was right" : "Crux was wrong"}</Badge>
                  <span className="dim small">
                    {l.machine_type} · written by {l.source} · confirmed by {l.confirmed_by || "nobody yet"}
                  </span>
                </div>
                <dl className="defs" style={{ marginTop: 6 }}>
                  <dt>When</dt>
                  <dd>{l.when}</dd>
                  <dt>Do</dt>
                  <dd>{l.do}</dd>
                  {l.avoid && (
                    <>
                      <dt>Avoid</dt>
                      <dd>{l.avoid}</dd>
                    </>
                  )}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
