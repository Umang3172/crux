// One watched machine's life against a clock. The page shows only what was
// known at the clock: how the life ended is an answer key, drawn only when a
// person asks. A forecast is a range for planning, never a promise.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AlarmClock, ChevronRight, ClipboardList, Eye, EyeOff, HeartPulse, Hourglass, Pause, Play, Search, Timer } from "lucide-react";
import { createTicket, investigateRecording, machine as fetchMachine, risk as fetchRisk } from "../api/crux";
import type { RecordingVerdict, Risk } from "../api/types";
import { hours, num, pct } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { CONCLUDE_AT, fault } from "../lib/plain";
import { LifeChart } from "../ui/charts";
import { Badge, Button, Callout, Card, CountUp, Details, ErrorState, Hint, Meter, Skeleton, SkeletonRows, SourceTag, Stat, cx, vt } from "../ui/kit";
import "./pages.css";
import "../styles/trust.css";

function Head({ id, title, sub, actions }: { id: string; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  // The plant page names this machine's tile the same way, so the name grows into this heading.
  return (
    <header className="page-head">
      <div className="col gap-1 grow">
        <h1 style={vt("m-life:" + id)}>{title}</h1>
        {sub && <p className="muted balance page-sub">{sub}</p>}
      </div>
      {actions && <div className="row row-wrap">{actions}</div>}
    </header>
  );
}

export default function MachinePage() {
  const id = useParams()["*"] ?? "";
  const navigate = useNavigate();
  const life = useAsync(() => fetchMachine(id), [id]);
  const [partIx, setPartIx] = useState(0);
  const [now, setNow] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [whole, setWhole] = useState(false);
  const [stopIn, setStopIn] = useState(1);
  const [risk, setRisk] = useState<Risk | null>(null);
  const [verdict, setVerdict] = useState<{ v: RecordingVerdict; at: number } | null>(null);
  const [busy, setBusy] = useState<"investigate" | "ticket" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const part = life.data?.parts[partIx];

  // The clock starts where the story does: the hour the alarm fired, or late in the life if it never did.
  useEffect(() => {
    if (part) setNow(part.alarm_h ?? Number((part.end_h * 0.8).toFixed(2)));
    setVerdict(null);
    setWhole(false);
  }, [part]);

  useEffect(() => {
    if (!playing || !part || now === null) return;
    if (now >= part.end_h) return setPlaying(false);
    const t = window.setTimeout(() => setNow((n) => Math.min(part.end_h, Number(((n ?? 0) + part.end_h / 240).toFixed(4)))), 60);
    return () => window.clearTimeout(t);
  }, [playing, now, part]);

  const at = useMemo(() => {
    if (!part || now === null) return null;
    let i = 0;
    while (i + 1 < part.t_h.length && part.t_h[i + 1] <= now) i++;
    const alarmed = part.alarm_h !== null && part.alarm_h <= now;
    const left = alarmed ? ([...part.time_left].reverse().find((t) => t.at_h <= now) ?? null) : null;
    return { hour: part.t_h[i], percent: part.percent[i], level: part.level[i], alarmed, left };
  }, [part, now]);

  const atHour = at?.hour;
  const alarmed = at?.alarmed;
  useEffect(() => {
    if (!part || atHour === undefined || !alarmed) return setRisk(null);
    let live = true;
    const t = window.setTimeout(() => {
      fetchRisk(id, part.part, atHour, stopIn)
        .then((r) => live && setRisk(r))
        .catch(() => live && setRisk(null));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [id, part, atHour, alarmed, stopIn]);

  async function investigate() {
    if (!part || !at) return;
    setBusy("investigate");
    setError(null);
    try {
      setVerdict({ v: await investigateRecording(id, part.part, at.hour), at: at.hour });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function draft() {
    if (!part || !at) return;
    setBusy("ticket");
    setError(null);
    try {
      const t = await createTicket({ machine: id, part: part.part, at_h: at.hour, stop_in_h: stopIn, investigate: true });
      navigate(`/work-orders/${t.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const crumbs = (name: ReactNode) => (
    <nav className="crumbs" aria-label="Breadcrumb">
      <Link to="/plant">Control room</Link>
      <ChevronRight size={12} aria-hidden />
      <span>{name}</span>
    </nav>
  );

  if (life.error) {
    return (
      <div className="page tr-page">
        <ErrorState error={life.error} onRetry={life.reload} />
      </div>
    );
  }
  if (!life.data || !part || !at || now === null) {
    return (
      <div className="page tr-page">
        {crumbs(id)}
        <Head id={id} title={<Skeleton h={22} w={260} />} />
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      </div>
    );
  }

  const m = life.data;
  const synthetic = /synthetic/i.test(m.source);
  const left = at.left;

  return (
    <div className="page tr-page">
      {crumbs(m.name)}
      <Head
        id={id}
        title={m.name}
        sub={synthetic ? undefined : m.source}
        actions={
          <>
            <span className="tr-with-hint">
              <SourceTag source={synthetic ? "synthetic life · physics model" : "recorded run"} />
              {synthetic && <Hint label="Where this life comes from">{m.source}</Hint>}
            </span>
            <Badge>
              bearing <span className="mono">{m.bearing}</span>
            </Badge>
          </>
        }
      />

      <div className="stats">
        <Stat
          label={
            <span className="tr-with-hint">
              <HeartPulse size={13} /> Health now
              <Hint label="What health means">100% vibrates as it did when new. Health is not the life left.</Hint>
            </span>
          }
          value={<CountUp value={at.percent} format={(n) => num(n, 0)} ms={240} />}
          unit="%"
          sub={`vibration ${num(at.level, 1)}× its normal`}
        />
        <Stat
          label={
            <>
              <AlarmClock size={13} /> Alarm
            </>
          }
          value={<span style={{ fontSize: "var(--fs-20)" }}>{at.alarmed ? `fired at ${num(part.alarm_h ?? 0, 1)} h` : "not fired"}</span>}
          sub={at.alarmed ? "vibration stayed well above normal" : "no forecast before it fires"}
        />
        <Stat
          label={
            <>
              <Hourglass size={13} /> Time left
            </>
          }
          value={<span style={{ fontSize: "var(--fs-20)" }}>{left ? `${hours(left.p10_h)} to ${hours(left.p90_h)}` : "–"}</span>}
          sub={left ? left.note || `likely ${hours(left.p50_h)} · a range for planning` : "no range yet"}
        />
        <div className="stat">
          <div className="stat-label">
            <Timer size={13} /> Risk before the next stop
          </div>
          <div className="stat-value">{!at.alarmed ? "–" : risk?.risk == null ? <span className="dim">…</span> : <CountUp value={risk.risk} format={pct} ms={320} />}</div>
          <label className="tr-stop">
            stop in
            <input className="input num" type="number" min={0.1} step={0.5} value={stopIn} onChange={(e) => setStopIn(Math.max(0.1, Number(e.target.value) || 0.1))} aria-label="Hours to the next planned stop" />
            h
          </label>
          {at.alarmed && risk?.risk != null && (
            <div className="tr-stat-meter">
              <Meter value={risk.risk} tone={risk.risk > 0.5 ? "warn" : "accent"} />
            </div>
          )}
          <div className="stat-sub">{!at.alarmed ? "no forecast before the alarm" : (risk?.note ?? "reading the forecast…")}</div>
        </div>
      </div>

      <Card
        id="life-chart"
        title="Health over running hours"
        icon={<HeartPulse size={15} />}
        sub={part.label}
        actions={
          <>
            {m.parts.length > 1 && (
              <select className="select input-sm" style={{ width: "auto" }} value={partIx} onChange={(e) => setPartIx(Number(e.target.value))} aria-label="Part">
                {m.parts.map((p, i) => (
                  <option key={p.part} value={i}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
            <Button size="sm" icon={whole ? <EyeOff size={13} /> : <Eye size={13} />} onClick={() => setWhole((w) => !w)}>
              {whole ? "Hide what happened next" : "Show what really happened"}
            </Button>
          </>
        }
      >
        <LifeChart
          t={part.t_h}
          percent={part.percent}
          now={now}
          alarm={part.alarm_h}
          band={left ? { at: left.at_h, lo: left.p10_h, mid: left.p50_h, hi: left.p90_h } : null}
          end={whole ? part.end_h : now}
          whole={whole}
        />
        <div className="scrub">
          <Button size="sm" icon={playing ? <Pause size={13} /> : <Play size={13} />} onClick={() => setPlaying((p) => !p)}>
            {playing ? "Pause" : "Play"}
          </Button>
          <input type="range" min={0} max={part.end_h} step={part.end_h / 240} value={now} onChange={(e) => setNow(Number(e.target.value))} aria-label="The clock, in running hours" />
          <span className="num muted nowrap">
            clock <b style={{ color: "var(--text)" }}>{num(now, 1)} h</b>
          </span>
        </div>
        <div className="tr-chart-foot">
          <span className="tr-legend">
            <span>
              <i className="tr-line-key" style={{ background: "var(--text)" }} /> health, up to the clock
            </span>
            <span>
              <i className="tr-line-key" style={{ background: "var(--warn)" }} /> alarm
            </span>
            <span>
              <i className="tr-band-key" /> time-left range
              <Hint label="About the range">Made from what was known at the clock: when the health may reach the danger line (0%). A range for planning, not a promise.</Hint>
            </span>
          </span>
        </div>
        {whole && (
          <div style={{ marginTop: 12 }}>
            <Callout tone="warn">
              Answer key: this part {part.failed ? `failed at ${num(part.end_h, 1)} h (${part.failure_mode})` : `was still running at ${num(part.end_h, 1)} h`}. Crux did not know this at the clock.
            </Callout>
          </div>
        )}
        <div className="tr-actbar">
          <Button variant="primary" icon={<Search size={14} />} busy={busy === "investigate"} disabled={busy !== null} onClick={investigate}>
            Investigate at {num(at.hour, 1)} h
          </Button>
          <Button icon={<ClipboardList size={14} />} busy={busy === "ticket"} disabled={busy !== null || !at.alarmed} onClick={draft}>
            Draft a work order
          </Button>
          {!at.alarmed && <span className="small dim">Needs the alarm: move the clock past it.</span>}
        </div>
        {error && (
          <div style={{ marginTop: 12 }}>
            <Callout tone="danger">{error}</Callout>
          </div>
        )}
      </Card>

      {verdict && <VerdictAtHour key={verdict.at} v={verdict.v} at={verdict.at} />}
    </div>
  );
}

function VerdictAtHour({ v, at }: { v: RecordingVerdict; at: number }) {
  return (
    <Card title={`Investigated at ${num(at, 1)} h`} icon={<Search size={15} />} tone={v.confident ? "ok" : undefined} actions={<Badge tone="accent">the engine's words</Badge>} className="tr-enter">
      <h3 style={{ fontSize: "var(--fs-16)" }}>{v.statement}</h3>
      {v.reason && <p className="muted" style={{ marginTop: 6 }}>{v.reason}</p>}
      <p className="small dim" style={{ marginTop: 6 }}>
        Read from {v.reading}.
      </p>
      <div className="leaders">
        {v.ranked.slice(0, 4).map((r, i) => (
          <div className="leader-row" key={r.kind}>
            <span className="truncate">
              <b>{fault(r.kind).name}</b> <span className="dim mono small">{fault(r.kind).technical}</span>
            </span>
            <b className="num" style={{ textAlign: "right" }}>
              {pct(r.belief)}
            </b>
            <Meter value={r.belief} mark={CONCLUDE_AT} tone={i === 0 && v.confident ? "ok" : i === 0 ? "accent" : "neutral"} />
          </div>
        ))}
      </div>
      {v.own_normal && (
        <div style={{ marginTop: "var(--s-4)" }}>
          <Details summary="What it was compared with">
            <dl className="voice" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
              <dt>Its own normal</dt>
              <dd>
                {v.own_normal.captures} of this part's early recordings
                {v.own_normal.level_rise !== null && (
                  <>
                    ; level now <b className="num">{num(v.own_normal.level_rise, 1)}×</b> that normal
                  </>
                )}
                .
              </dd>
              {v.own_normal.largest_changes.length > 0 && (
                <>
                  <dt>Largest changes</dt>
                  <dd>
                    {v.own_normal.largest_changes.map((c) => (
                      <div key={c.line}>
                        <span className="mono">{c.line}</span>: <b className="num">{num(c.times_normal, 1)}×</b> its normal
                      </div>
                    ))}
                  </dd>
                </>
              )}
              {v.against_textbook && (
                <>
                  <dt>A textbook machine</dt>
                  <dd className={cx(v.against_textbook.leader.kind !== v.leader.kind && "t-warn")}>
                    Scored against a textbook machine instead, it ends {v.against_textbook.outcome}, pointing at {fault(v.against_textbook.leader.kind).name.toLowerCase()} ({pct(v.against_textbook.leader.belief)}).
                    {v.against_textbook.leader.kind !== v.leader.kind && " The two disagree: this is what a machine's own normal changes."}
                  </dd>
                </>
              )}
            </dl>
          </Details>
        </div>
      )}
    </Card>
  );
}
