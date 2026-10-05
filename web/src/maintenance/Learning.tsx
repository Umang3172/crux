/**
 * Learning across sites: this site's updates from the hub and its lesson memory.
 *
 * An update is shown with the test the site ran on its own past failures; only
 * a person can install it, and only if it did no worse. Lessons are what the
 * site and other sites learned from confirmed cases, successes and misses alike.
 */

import { useCallback, useEffect, useState } from "react";
import {
  FleetStatus,
  Lesson,
  Score,
  fleetApprove,
  fleetLessons,
  fleetPull,
  fleetRollback,
  fleetStatus,
} from "./api";

function n(x: number | null | undefined, pct = false): string {
  if (x === null || x === undefined) return "–";
  return pct ? `${Math.round(x * 100)}%` : x.toFixed(2);
}

function ScoreRow({ label, s, better }: { label: string; s: Score; better?: boolean }) {
  return (
    <tr className={better ? "better" : ""}>
      <td>
        {label} <span className="m-muted">({s.model})</span>
      </td>
      <td>{n(s.error)}</td>
      <td>{n(s.late, true)}</td>
      <td>{n(s.inside, true)}</td>
    </tr>
  );
}

export function Learning({ machineType }: { machineType: string }) {
  const [status, setStatus] = useState<FleetStatus | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [news, setNews] = useState<string[]>([]);
  const [who, setWho] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    fleetStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
    fleetLessons(machineType)
      .then(setLessons)
      .catch(() => setLessons([]));
  }, [machineType]);

  useEffect(refresh, [refresh]);

  const act = (p: Promise<unknown>, after?: (r: unknown) => void) => {
    setBusy(true);
    setError(null);
    p.then((r) => after?.(r))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setBusy(false);
        refresh();
      });
  };

  const pull = () =>
    act(fleetPull(), (r) => {
      const res = r as Awaited<ReturnType<typeof fleetPull>>;
      const lines = res.alerts.flatMap((a) => a.lessons.map((l) => `Alert from the hub: “${l}”`));
      if (res.staged)
        lines.push("A monthly update arrived and was tested on this site's own failures.");
      res.rejected.forEach((x) => lines.push(`Refused an update: ${x.why}`));
      setNews(lines.length ? lines : ["Nothing new from the hub."]);
    });

  if (!status) return null;
  const staged = status.staged;
  const rep = staged?.report;
  const better =
    rep?.candidate && rep?.current && (rep.candidate.error ?? 1e9) <= (rep.current.error ?? 1e9);

  return (
    <section className="m-sheet m-learning">
      <header className="m-machine-head">
        <div>
          <p className="m-kicker">Learning across sites</p>
          <h2>This site: {status.site}</h2>
          <p className="m-muted">
            Time-left model in use: {status.model}
            {status.active ? ` (update ${status.active})` : " (built in)"} · {status.lessons}{" "}
            lessons in memory · hub has {status.hub_versions.length} updates
          </p>
        </div>
        <button className="m-ticket-btn" onClick={pull} disabled={busy}>
          Check for updates
        </button>
      </header>
      {news.length > 0 && (
        <ul className="m-news">
          {news.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      {error && <p className="m-error">{error}</p>}

      {staged && rep && (
        <div className="m-update">
          <h3>Update {staged.version} is waiting</h3>
          <p className="m-muted">
            {rep.runs
              ? `Tested on ${rep.runs} failures at this site that the update was never trained on.`
              : rep.reason}
          </p>
          {rep.current && rep.candidate && (
            <table className="m-table">
              <thead>
                <tr>
                  <th>model</th>
                  <th>off by (share of time left)</th>
                  <th>early end too late</th>
                  <th>truth inside the range</th>
                </tr>
              </thead>
              <tbody>
                <ScoreRow label="in use" s={rep.current} />
                <ScoreRow label="update" s={rep.candidate} better={!!better} />
              </tbody>
            </table>
          )}
          <p className={rep.passes === false ? "m-error" : "m-fine"}>
            {rep.passes === false
              ? "Worse than the model in use here: it cannot be installed."
              : rep.passes
                ? "No worse on either count: a person can install it."
                : "No local evidence either way: a person decides."}
          </p>
          {rep.passes !== false && (
            <div className="m-approve">
              <input
                placeholder="Your name"
                value={who}
                onChange={(e) => setWho(e.target.value)}
                aria-label="Approver's name"
              />
              <button onClick={() => act(fleetApprove(who.trim()))} disabled={!who.trim() || busy}>
                Install update
              </button>
            </div>
          )}
        </div>
      )}
      {!staged && status.active !== null && (
        <div className="m-approve">
          <input
            placeholder="Your name"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            aria-label="Name for the rollback"
          />
          <button
            className="danger"
            onClick={() => act(fleetRollback(who.trim()))}
            disabled={!who.trim() || busy}
          >
            Roll back update {status.active}
          </button>
        </div>
      )}

      <h3>Lessons for {machineType}s</h3>
      {lessons.length === 0 ? (
        <p className="m-muted">
          No lessons yet. They arrive from the hub, and from every case a technician closes here.
        </p>
      ) : (
        <ul className="m-lessons">
          {lessons.map((l) => (
            <li key={l.id}>
              <p>
                <strong>{l.title}</strong>{" "}
                <span className={`m-chip${l.outcome === "failure" ? " alarmed" : ""}`}>
                  {l.outcome === "failure" ? "learned from a miss" : "learned from a hit"}
                </span>
              </p>
              <p className="m-muted">When: {l.when}</p>
              <p>Do: {l.do}</p>
              {l.avoid && <p className="m-muted">Avoid: {l.avoid}</p>}
              <p className="m-fine">
                From {l.source}
                {l.confirmed_by ? `, confirmed by ${l.confirmed_by}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
