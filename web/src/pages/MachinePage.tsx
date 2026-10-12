// One machine's life against a clock. The page shows only what was known at
// the clock: how the life ended is an answer key, drawn only when asked.

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ChevronRight, ClipboardList, Eye, EyeOff, HeartPulse, Pause, Play, Search, Timer } from "lucide-react";
import { createTicket, investigateRecording, machine as fetchMachine, risk as fetchRisk } from "../api/crux";
import type { RecordingVerdict, Risk } from "../api/types";
import { hours, num, pct } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { fault } from "../lib/plain";
import { LifeChart } from "../ui/charts";
import { Badge, Button, Callout, Card, ErrorState, Meter, PageHead, SkeletonRows, SourceTag, Stat } from "../ui/kit";
import "./pages.css";

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
  const [verdict, setVerdict] = useState<RecordingVerdict | null>(null);
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
      setVerdict(await investigateRecording(id, part.part, at.hour));
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

  if (life.error) {
    return (
      <div className="page">
        <ErrorState error={life.error} onRetry={life.reload} />
      </div>
    );
  }
  if (!life.data || !part || !at || now === null) {
    return (
      <div className="page">
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      </div>
    );
  }

  const m = life.data;
  const synthetic = /synthetic/i.test(m.source);

  return (
    <div className="page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/machines">Machines</Link>
        <ChevronRight size={12} aria-hidden />
        <span>{m.name}</span>
      </nav>
      <PageHead
        title={m.name}
        sub={m.source}
        actions={
          <>
            <SourceTag source={synthetic ? "synthetic life · physics model" : "recorded run"} />
            <Badge>
              bearing <span className="mono">{m.bearing}</span>
            </Badge>
          </>
        }
      />

      <div className="stats">
        <Stat label="Health of this part" icon={<HeartPulse size={13} />} value={num(at.percent, 0)} unit="%" sub="100% vibrates as it did when new. This is not life left." />
        <Stat label="Vibration" value={`${num(at.level, 1)}×`} sub="its own normal level" />
        <Stat label="Alarm" value={<span style={{ fontSize: "1.25rem" }}>{at.alarmed ? `fired at ${num(part.alarm_h ?? 0, 1)} h` : "not fired"}</span>} sub={at.alarmed ? "vibration stayed well above its own healthy level" : "Crux gives no forecast before it fires"} />
        <Stat
          label="Fix within"
          icon={<Timer size={13} />}
          value={<span style={{ fontSize: "1.25rem" }}>{at.left ? `${hours(at.left.p10_h)} to ${hours(at.left.p90_h)}` : "–"}</span>}
          sub={at.left ? (at.left.note || `most likely ${hours(at.left.p50_h)}; a range for planning`) : "no range yet"}
        />
      </div>

      <div className="split">
        <div className="col" style={{ gap: "var(--s-5)" }}>
          <Card
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
              band={at.left ? { at: at.left.at_h, lo: at.left.p10_h, mid: at.left.p50_h, hi: at.left.p90_h } : null}
              end={whole ? part.end_h : now}
              whole={whole}
            />
            <div className="scrub">
              <Button size="sm" icon={playing ? <Pause size={13} /> : <Play size={13} />} onClick={() => setPlaying((p) => !p)}>
                {playing ? "Pause" : "Play"}
              </Button>
              <input type="range" min={0} max={part.end_h} step={part.end_h / 240} value={now} onChange={(e) => setNow(Number(e.target.value))} aria-label="The clock, in running hours" />
              <span className="num muted nowrap">
                clock at <b style={{ color: "var(--text)" }}>{num(now, 1)} h</b>
              </span>
            </div>
            {whole && (
              <div style={{ marginTop: 12 }}>
                <Callout tone="warn">
                  The answer key: this part {part.failed ? `failed at ${num(part.end_h, 1)} h (${part.failure_mode})` : `was still running at ${num(part.end_h, 1)} h`}. Crux did not know this at the clock.
                </Callout>
              </div>
            )}
            <p className="small dim" style={{ marginTop: 10 }}>
              The line is drawn only up to the clock. The shaded band is the forecast range for reaching the danger line (0%), made from what was known then.
            </p>
          </Card>

          {verdict && <VerdictAtHour v={verdict} />}
        </div>

        <aside className="col rail" style={{ gap: "var(--s-5)" }}>
          <Card title="At the clock" icon={<Search size={15} />}>
            <div className="col gap-3">
              <Button variant="primary" block icon={<Search size={14} />} busy={busy === "investigate"} disabled={busy !== null} onClick={investigate}>
                Investigate at {num(at.hour, 1)} h
              </Button>
              <Button block icon={<ClipboardList size={14} />} busy={busy === "ticket"} disabled={busy !== null || !at.alarmed} onClick={draft}>
                Draft a work order
              </Button>
              {!at.alarmed && <span className="small dim">A work order is drafted from an alarm. Move the clock past the alarm to draft one.</span>}
              {error && <Callout tone="danger">{error}</Callout>}
            </div>
          </Card>

          <Card title="Risk before the next planned stop" icon={<Timer size={15} />}>
            <div className="row">
              <span className="muted">Next stop in</span>
              <input className="input num" style={{ width: 76 }} type="number" min={0.1} step={0.5} value={stopIn} onChange={(e) => setStopIn(Math.max(0.1, Number(e.target.value) || 0.1))} aria-label="Hours to the next planned stop" />
              <span className="muted">hours</span>
            </div>
            <div style={{ marginTop: 14 }}>
              {!at.alarmed ? (
                <span className="dim">No forecast yet: the alarm has not fired.</span>
              ) : risk?.risk == null ? (
                <span className="dim">{risk?.note ?? "Reading the forecast…"}</span>
              ) : (
                <>
                  <div className="row" style={{ alignItems: "baseline" }}>
                    <span style={{ fontSize: "1.75rem", fontWeight: 640 }} className="num">
                      {pct(risk.risk)}
                    </span>
                    <span className="muted">chance it reaches the danger line first</span>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <Meter value={risk.risk} tone={risk.risk > 0.5 ? "warn" : "accent"} />
                  </div>
                  <p className="small dim" style={{ marginTop: 8 }}>
                    {risk.note}
                  </p>
                </>
              )}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function VerdictAtHour({ v }: { v: RecordingVerdict }) {
  return (
    <Card title="Investigated at the clock" icon={<Search size={15} />} tone={v.confident ? "ok" : undefined} actions={<Badge tone="accent">the engine's words</Badge>}>
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
            <Meter value={r.belief} mark={0.8} tone={i === 0 && v.confident ? "ok" : i === 0 ? "accent" : "neutral"} />
          </div>
        ))}
      </div>
      {v.own_normal && (
        <dl className="voice">
          <dt>Compared with</dt>
          <dd>
            {v.own_normal.captures} of this part's own early recordings
            {v.own_normal.level_rise !== null && (
              <>
                ; its level is now <b className="num">{num(v.own_normal.level_rise, 1)}×</b> that normal
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
              <dt>Against a textbook machine</dt>
              <dd>
                The same reading scored against a textbook machine instead of this one's own normal ends {v.against_textbook.outcome}, pointing at {fault(v.against_textbook.leader.kind).name.toLowerCase()} ({pct(v.against_textbook.leader.belief)}).
                {v.against_textbook.leader.kind !== v.leader.kind && " The two disagree: this is what a machine's own normal changes."}
              </dd>
            </>
          )}
        </dl>
      )}
    </Card>
  );
}
