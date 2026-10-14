// Learning across sites: this site's forecasting model, an update from other
// sites waiting for a person's decision, and the lessons repairs left behind.
// Nothing installs itself, and no control is shown for a step this server
// cannot take.

import { useState } from "react";
import { BookOpen, Download, Network as NetworkIcon, RotateCcw, ShieldCheck } from "lucide-react";
import { fleetApprove, fleetPull, fleetRollback, fleetStatus, lessons as fetchLessons } from "../api/crux";
import type { FleetStatus } from "../api/types";
import { num, pct, stamp } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { Badge, Button, Callout, Card, Details, Empty, ErrorState, LinkButton, PageHead, SkeletonRows, Stat, toast } from "../ui/kit";
import "./pages.css";
import "../styles/trust.css";

type Act = (name: string, fn: () => Promise<string>) => void;

function Updates({ s, busy, act }: { s: FleetStatus; busy: string | null; act: Act }) {
  const [by, setBy] = useState("");
  const hasHub = s.hub_versions.length > 0;
  const staged = s.staged;
  const canInstall = !!staged && staged.report.passes !== false;
  const canRollBack = s.active !== null;

  if (!hasHub && !staged && !canRollBack && s.history.length === 0) {
    return (
      <Card title="Updates from other sites" icon={<Download size={15} />}>
        <Empty left icon={<NetworkIcon size={18} />} title="No hub connected">
          Updates need a hub, and a person to install them.
        </Empty>
      </Card>
    );
  }

  return (
    <Card title="Updates from other sites" icon={<Download size={15} />}>
      <div className="col gap-4">
        {staged ? (
          <div className="col gap-3">
            <div className="row row-wrap">
              <h3 style={{ fontSize: "var(--fs-16)" }}>Version {staged.version}</h3>
              <Badge tone={staged.report.passes === false ? "danger" : staged.report.passes ? "ok" : "warn"} dot>
                {staged.report.passes === false ? "worse on this site's failures" : staged.report.passes ? "passed on this site's failures" : "a person decides"}
              </Badge>
            </div>
            <p className="muted">{staged.report.reason}</p>
            {staged.report.current && staged.report.candidate && (
              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th className="t-num" data-tip="Typical miss of the most likely estimate, as a share of the time that was left">
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
                      { label: "Installed now", r: staged.report.current },
                      { label: "The update", r: staged.report.candidate },
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
              </div>
            )}
          </div>
        ) : (
          <Empty
            left
            icon={<ShieldCheck size={18} />}
            title="No update waiting"
            action={
              hasHub && (
                <Button icon={<Download size={14} />} busy={busy === "pull"} disabled={busy !== null} onClick={() => act("pull", async () => {
                  const r = await fleetPull();
                  return `Checked. ${r.staged ? "One update is waiting for a decision." : "Nothing new to install."}${r.rejected.length ? ` ${r.rejected.length} rejected.` : ""}`;
                })}>
                  Check for updates
                </Button>
              )
            }
          >
            {hasHub ? "An update is tested on this site's own failures before anyone is asked." : "No hub is connected, so nothing new can arrive."}
          </Empty>
        )}

        {(canInstall || canRollBack) && (
          <div className="row row-wrap">
            <input className="input" style={{ width: 170 }} placeholder="Your name" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Your name, to decide on the update" />
            {canInstall && (
              <Button variant="primary" icon={<ShieldCheck size={14} />} busy={busy === "approve"} disabled={!by.trim() || busy !== null} onClick={() => act("approve", async () => {
                const r = await fleetApprove(by.trim());
                return `Installed version ${r.active}. ${r.lessons_added} lesson${r.lessons_added === 1 ? "" : "s"} added.`;
              })}>
                Install update
              </Button>
            )}
            {canRollBack && (
              <Button variant="ghost" icon={<RotateCcw size={14} />} busy={busy === "rollback"} disabled={!by.trim() || busy !== null} onClick={() => act("rollback", async () => {
                const r = await fleetRollback(by.trim());
                return `Rolled back to ${r.active === null ? "this site's own model" : `version ${r.active}`}.`;
              })}>
                Roll back
              </Button>
            )}
          </div>
        )}

        {s.history.length > 0 && (
          <Details summary={`Decisions at this site · ${s.history.length}`}>
            <div className="table-wrap">
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
            </div>
          </Details>
        )}
      </div>
    </Card>
  );
}

export default function Network() {
  const status = useAsync(() => fleetStatus(), []);
  const [q, setQ] = useState("");
  const lessons = useAsync(() => fetchLessons("rolling bearing", q, 20), [q]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act: Act = async (name, fn) => {
    setBusy(name);
    setError(null);
    try {
      toast(await fn());
      status.reload();
      lessons.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const s = status.data;
  const any = (lessons.data?.length ?? 0) > 0;

  return (
    <div className="page tr-page">
      <PageHead title="Lessons and updates" sub="What repairs teach this site, and updates from other sites." />

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
            <Stat label="This site" value={<span style={{ fontSize: "var(--fs-20)" }}>{s.site}</span>} sub={`forecast model: ${s.model}`} />
            <Stat label="Installed update" value={s.active === null ? "none" : `v${s.active}`} sub={s.active === null ? "running on its own model" : "installed by a person"} />
            <Stat label="Lessons on file" value={s.lessons} sub="from recorded repairs" />
          </div>
          <Updates s={s} busy={busy} act={act} />
          {error && <Callout tone="danger">{error}</Callout>}
        </>
      )}

      <Card
        title="Lessons"
        icon={<BookOpen size={15} />}
        flush
        actions={(any || q) && <input className="input input-sm" style={{ width: 200 }} placeholder="Search lessons" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search lessons" />}
      >
        {lessons.error ? (
          <ErrorState error={lessons.error} onRetry={lessons.reload} />
        ) : !lessons.data ? (
          <SkeletonRows />
        ) : lessons.data.length === 0 ? (
          q ? (
            <Empty left icon={<BookOpen size={18} />} title="No lesson matches" />
          ) : (
            <Empty left icon={<BookOpen size={18} />} title="No lessons yet" action={<LinkButton to="/work-orders">Open work orders</LinkButton>}>
              One is saved when someone records what a repair found.
            </Empty>
          )
        ) : (
          <ul className="tr-rows">
            {lessons.data.map((l) => (
              <li key={l.id}>
                <div className="row row-wrap">
                  <b>{l.title}</b>
                  <Badge tone={l.outcome === "success" ? "ok" : "warn"}>{l.outcome === "success" ? "what worked" : "a pitfall"}</Badge>
                  <span className="dim small">
                    {l.machine_type} · from {l.source}
                    {l.confirmed_by ? ` · confirmed by ${l.confirmed_by}` : ""}
                  </span>
                </div>
                <dl className="tr-defs">
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
