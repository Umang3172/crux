/**
 * Predictive maintenance: a health percent per part, and by when to fix it.
 *
 * The screen replays a bearing life that was recorded until it broke. Scrub or
 * play the timeline and every value shown is what Crux would have said at that
 * moment, using only what it had seen so far. "Show what really happened" adds
 * the true failure, so anyone can judge the call.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { MachineReplay, MachineSummary, PartReplay, TimeLeft, machine, machines } from "./api";
import { Learning } from "./Learning";
import { TicketPanel } from "./TicketPanel";
import "./maintenance.css";

// ------------------------------------------------------------------ helpers

function hours(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

/** Index of the last sample at or before `t` (0 if none). */
function at(ts: number[], t: number): number {
  let lo = 0;
  let hi = ts.length - 1;
  if (t < ts[0]) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

type PartNow = {
  part: PartReplay;
  percent: number;
  level: number;
  alarmed: boolean;
  range: TimeLeft | null;
};

function partAt(part: PartReplay, now: number): PartNow {
  const i = at(part.t_h, now);
  const alarmed = part.alarm_h !== null && part.alarm_h <= now;
  const shown = part.time_left.filter((r) => r.at_h <= now);
  return {
    part,
    percent: part.percent[i],
    level: part.level[i],
    alarmed,
    range: alarmed && shown.length ? shown[shown.length - 1] : null,
  };
}

function rangeText(r: TimeLeft): string {
  if (r.p50_h === null || r.p10_h === null || r.p90_h === null) return "no estimate yet";
  if (r.p90_h <= 0.02) return "now";
  const lo = hours(r.p10_h);
  const hi = hours(r.p90_h);
  return lo === hi ? `within ${hi}` : `within ${lo} to ${hi}`;
}

/** The plain-words account of one part at one moment. */
function story(p: PartNow, now: number, reveal: boolean): string[] {
  const { part, percent, level, alarmed, range } = p;
  const lines: string[] = [];
  if (!alarmed) {
    lines.push(
      percent >= 95
        ? `${part.label} is vibrating much as it did when new.`
        : `${part.label} has worn since it was new: its sharpest knocks have reached about ${(10 ** ((100 - percent) / 100)).toFixed(1)}× what they were. Its overall vibration (${level.toFixed(1)}× normal) has not doubled, so there is no alarm yet.`,
    );
  } else {
    lines.push(
      `Crux raised the alarm at running hour ${Math.round(part.alarm_h ?? 0)}, when ${part.label.toLowerCase()}'s vibration had more than doubled and stayed there. It is now ${level.toFixed(1)}× its normal level.`,
    );
    if (range) {
      lines.push(
        range.p50_h !== null && range.p50_h > 0.02
          ? `Plan the repair ${rangeText(range)}; most likely about ${hours(range.p50_h)} from now.`
          : "It is at the danger line: repair now.",
      );
    }
    lines.push("Next, Crux investigates what is wrong before anyone opens the machine.");
  }
  if (reveal) {
    lines.push(
      part.failed
        ? now >= part.end_h
          ? `What really happened: it failed here (${part.failure_mode}).`
          : `What really happened: it failed ${hours(part.end_h - now)} later (${part.failure_mode}).`
        : "What really happened: it survived the test.",
    );
  }
  return lines;
}

// ------------------------------------------------------------------ battery

function Battery({ percent, alarmed, big }: { percent: number; alarmed: boolean; big?: boolean }) {
  const w = big ? 132 : 64;
  const h = big ? 54 : 26;
  const pad = big ? 5 : 3;
  const fill = Math.max(0, Math.min(100, percent)) / 100;
  return (
    <svg
      className={`m-battery${alarmed ? " alarmed" : ""}`}
      width={w + (big ? 10 : 6)}
      height={h}
      viewBox={`0 0 ${w + (big ? 10 : 6)} ${h}`}
      role="img"
      aria-label={`${Math.round(percent)}% health`}
    >
      <rect x={1} y={1} width={w - 2} height={h - 2} rx={big ? 10 : 6} className="m-battery-case" />
      <rect
        x={w}
        y={h * 0.3}
        width={big ? 8 : 4}
        height={h * 0.4}
        rx={2}
        className="m-battery-cap"
      />
      <rect
        x={1 + pad}
        y={1 + pad}
        width={Math.max(0, (w - 2 - 2 * pad) * fill)}
        height={h - 2 - 2 * pad}
        rx={big ? 6 : 3}
        className="m-battery-fill"
      />
    </svg>
  );
}

// ------------------------------------------------------------------ charts

const W = 760;
const H = 250;
const M = { l: 44, r: 14, t: 14, b: 30 };

function ticks(x0: number, x1: number, n = 6): number[] {
  const raw = (x1 - x0) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(x0 / step) * step; v <= x1 + 1e-9; v += step) out.push(v);
  return out;
}

/** Time ticks on whole hours, or whole days once the window is long. */
const HOUR_STEPS = [0.25, 0.5, 1, 2, 3, 6, 12, 24, 48, 96, 168, 336];

function timeTicks(x0: number, x1: number, n = 6): { v: number; label: string }[] {
  const step = HOUR_STEPS.find((s) => s >= (x1 - x0) / n) ?? HOUR_STEPS[HOUR_STEPS.length - 1];
  const out: { v: number; label: string }[] = [];
  for (let v = Math.ceil(x0 / step) * step; v <= x1 + 1e-9; v += step) {
    out.push({
      v,
      label: step >= 24 ? `day ${Math.round(v / 24)}` : `${Math.round(v * 100) / 100} h`,
    });
  }
  return out;
}

function HealthChart({
  parts,
  selected,
  now,
  x0,
  x1,
  reveal,
  onSelect,
}: {
  parts: PartReplay[];
  selected: string;
  now: number;
  x0: number;
  x1: number;
  reveal: boolean;
  onSelect: (part: string) => void;
}) {
  const sx = (t: number) => M.l + ((t - x0) / (x1 - x0)) * (W - M.l - M.r);
  const sy = (p: number) => M.t + (1 - p / 100) * (H - M.t - M.b);
  const shownUntil = reveal ? x1 : Math.min(now, x1);
  const ordered = [...parts].sort(
    (a, b) => Number(a.part === selected) - Number(b.part === selected),
  );
  return (
    <svg
      className="m-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Health percent over time"
    >
      {[0, 25, 50, 75, 100].map((p) => (
        <g key={p}>
          <line x1={M.l} x2={W - M.r} y1={sy(p)} y2={sy(p)} className="m-grid" />
          <text x={M.l - 8} y={sy(p) + 4} className="m-tick" textAnchor="end">
            {p}%
          </text>
        </g>
      ))}
      {timeTicks(x0, x1).map(({ v, label }) => (
        <text key={v} x={sx(v)} y={H - 8} className="m-tick" textAnchor="middle">
          {label}
        </text>
      ))}
      {ordered.map((part) => {
        const pts = part.t_h
          .map((t, i) => [t, part.percent[i]] as const)
          .filter(([t]) => t >= x0 && t <= shownUntil);
        if (!pts.length) return null;
        const d = pts.map(([t, p]) => `${sx(t).toFixed(1)},${sy(p).toFixed(1)}`).join(" ");
        const isSel = part.part === selected;
        const alarm = part.alarm_h;
        return (
          <g
            key={part.part}
            className={`m-line${isSel ? " selected" : ""}`}
            onClick={() => onSelect(part.part)}
          >
            <polyline points={d} />
            <polyline points={d} className="m-hit" />
            {alarm !== null && alarm >= x0 && alarm <= shownUntil && (
              <circle
                cx={sx(alarm)}
                cy={sy(part.percent[at(part.t_h, alarm)])}
                r={isSel ? 5 : 3.5}
                className="m-alarm-dot"
              />
            )}
            {reveal && part.failed && part.end_h <= x1 && (
              <text
                x={sx(part.end_h)}
                y={sy(part.percent[part.percent.length - 1]) + 4}
                className="m-fail-mark"
                textAnchor="middle"
              >
                ×
              </text>
            )}
          </g>
        );
      })}
      {now >= x0 && now <= x1 && (
        <g className="m-now">
          <line x1={sx(now)} x2={sx(now)} y1={M.t} y2={H - M.b} />
          <text x={sx(now) + 5} y={M.t + 10}>
            now
          </text>
        </g>
      )}
    </svg>
  );
}

function TimeLeftChart({ part, now, reveal }: { part: PartReplay; now: number; reveal: boolean }) {
  const W2 = 400;
  const H2 = 220;
  const m = { l: 44, r: 12, t: 12, b: 30 };
  const a = part.alarm_h;
  if (a === null || now < a) {
    return (
      <p className="m-empty">
        No time-left range yet. Crux gives one once the alarm goes off, never while the part still
        looks healthy.
      </p>
    );
  }
  const x0 = a;
  const x1 = Math.max(part.end_h, a + 1e-3);
  const visible = part.time_left.filter((r) => r.at_h <= now && r.p10_h !== null);
  const truthAtAlarm = part.end_h - a;
  const top =
    Math.max(part.failed ? truthAtAlarm : 0, ...visible.map((r) => r.p50_h ?? 0), 1 / 6) * 1.25;
  const sx = (t: number) => m.l + ((t - x0) / (x1 - x0)) * (W2 - m.l - m.r);
  const sy = (h: number) => m.t + (1 - Math.min(h, top) / top) * (H2 - m.t - m.b);
  const band =
    visible.map((r) => `${sx(r.at_h)},${sy(r.p90_h ?? 0)}`).join(" ") +
    " " +
    [...visible]
      .reverse()
      .map((r) => `${sx(r.at_h)},${sy(r.p10_h ?? 0)}`)
      .join(" ");
  const mid = visible.map((r) => `${sx(r.at_h)},${sy(r.p50_h ?? 0)}`).join(" ");
  return (
    <svg
      className="m-chart"
      viewBox={`0 0 ${W2} ${H2}`}
      role="img"
      aria-label="Time left, predicted and actual"
    >
      {ticks(0, top, 4).map((v) => (
        <g key={v}>
          <line x1={m.l} x2={W2 - m.r} y1={sy(v)} y2={sy(v)} className="m-grid" />
          <text x={m.l - 8} y={sy(v) + 4} className="m-tick" textAnchor="end">
            {v < 1 ? `${Math.round(v * 60)}m` : `${Math.round(v)}h`}
          </text>
        </g>
      ))}
      <text x={m.l} y={H2 - 8} className="m-tick">
        alarm
      </text>
      <text x={W2 - m.r} y={H2 - 8} className="m-tick" textAnchor="end">
        {part.failed ? "failure" : "end of test"}
      </text>
      {visible.length > 1 && <polygon points={band} className="m-band" />}
      {visible.length > 1 && <polyline points={mid} className="m-mid" />}
      {reveal && part.failed && (
        <line x1={sx(x0)} y1={sy(truthAtAlarm)} x2={sx(x1)} y2={sy(0)} className="m-truth" />
      )}
      <g className="m-now">
        <line x1={sx(Math.min(now, x1))} x2={sx(Math.min(now, x1))} y1={m.t} y2={H2 - m.b} />
      </g>
    </svg>
  );
}

// ------------------------------------------------------------------ view

type Zoom = "final" | "whole";

export function Maintenance() {
  const [list, setList] = useState<MachineSummary[] | null>(null);
  const [note, setNote] = useState("");
  const [synthetic, setSynthetic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<MachineReplay | null>(null);
  const [selected, setSelected] = useState("");
  const [now, setNow] = useState(0);
  const [zoom, setZoom] = useState<Zoom>("final");
  const [reveal, setReveal] = useState(false);
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    machines()
      .then((r) => {
        setList(r.machines);
        setNote(r.note);
        setSynthetic(Boolean(r.synthetic));
        if (r.machines.length) open(r.machines[0].machine);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (id: string) => {
    setPlaying(false);
    machine(id)
      .then((m) => {
        setCurrent(m);
        const first = m.parts.find((p) => p.failed) ?? m.parts[0];
        setSelected(first.part);
        const alarms = m.parts.map((p) => p.alarm_h).filter((a): a is number => a !== null);
        setNow(alarms.length ? Math.max(0, Math.min(...alarms) - finalLead(m)) : 0);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  const window_ = useMemo(() => {
    if (!current) return [0, 1] as const;
    const alarms = current.parts.map((p) => p.alarm_h).filter((a): a is number => a !== null);
    if (zoom === "whole" || !alarms.length) return [0, current.end_h] as const;
    return [Math.max(0, Math.min(...alarms) - finalLead(current)), current.end_h] as const;
  }, [current, zoom]);
  const [x0, x1] = window_;

  // Play: the visible window passes in about 20 seconds.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const step = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      setNow((n) => {
        const next = n + ((x1 - x0) / 20) * dt;
        if (next >= x1) {
          setPlaying(false);
          return x1;
        }
        return next;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [playing, x0, x1]);

  if (error) {
    return (
      <div className="m-shell">
        <p className="m-empty">
          Crux could not load the maintenance data ({error}). Is the API running?
        </p>
      </div>
    );
  }
  if (list === null)
    return (
      <div className="m-shell">
        <p className="m-empty">Loading…</p>
      </div>
    );
  if (!list.length)
    return (
      <div className="m-shell">
        <p className="m-empty">{note}</p>
      </div>
    );

  const parts = current?.parts.map((p) => partAt(p, now)) ?? [];
  const focus = parts.find((p) => p.part.part === selected) ?? parts[0];
  const worst = [...parts].sort(
    (a, b) => Number(b.alarmed) - Number(a.alarmed) || a.percent - b.percent,
  )[0];

  return (
    <div className="m-shell">
      <section className="m-hero">
        <p className="m-kicker">Predictive maintenance</p>
        <h1>Which machine needs you, and by when.</h1>
        <p className="m-lede">
          Every part gets a health percent, like a phone battery: 100% is as good as new, 0% is the
          danger line.{" "}
          {synthetic
            ? "Below is a synthetic pump life, made by a physics model because no recorded run is on this server."
            : "Below is a real bearing test, recorded until parts broke."}{" "}
          Play it and see what Crux would have told the team at each moment.
        </p>
      </section>

      <nav className="m-machines" aria-label="Machine">
        {groups(list).map(([source, rows]) => (
          <div key={source} className="m-group">
            <span className="m-group-name">{source}</span>
            <div className="m-group-items">
              {rows.map((m) => (
                <button
                  key={m.machine}
                  aria-pressed={current?.machine === m.machine}
                  onClick={() => open(m.machine)}
                  title={m.name}
                >
                  <span className="m-machine-name">{shortName(m.name)}</span>
                  <span className="m-machine-meta">{hours(m.end_h)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {current && focus && (
        <div className="m-stage">
          <section className="m-sheet m-main">
            <header className="m-machine-head">
              <div>
                <h2>{current.name}</h2>
                <p className="m-muted">{current.source}</p>
              </div>
              {worst && (
                <div className="m-overall">
                  <span className="m-muted">Machine health (its worst part)</span>
                  <strong className={worst.alarmed ? "alarmed" : ""}>
                    {Math.round(worst.percent)}%
                  </strong>
                </div>
              )}
            </header>

            <div className="m-parts">
              {parts.map((p) => (
                <button
                  key={p.part.part}
                  className={`m-part${p.part.part === selected ? " selected" : ""}`}
                  onClick={() => setSelected(p.part.part)}
                >
                  <span className="m-part-label">{p.part.label}</span>
                  <Battery percent={p.percent} alarmed={p.alarmed} />
                  <span className="m-part-pct">{Math.round(p.percent)}%</span>
                  <span className={`m-chip${p.alarmed ? " alarmed" : ""}`}>
                    {p.alarmed ? "Needs attention" : "No alarm"}
                  </span>
                  {p.range && <span className="m-part-range">Fix {rangeText(p.range)}</span>}
                </button>
              ))}
            </div>

            <div className="m-timeline">
              <button
                className="m-play"
                onClick={() => {
                  if (now >= x1) setNow(x0);
                  setPlaying((v) => !v);
                }}
              >
                {playing ? "Pause" : now >= x1 ? "Replay" : "Play"}
              </button>
              <input
                type="range"
                min={x0}
                max={x1}
                step={(x1 - x0) / 1000}
                value={Math.min(Math.max(now, x0), x1)}
                onChange={(e) => {
                  setPlaying(false);
                  setNow(Number(e.target.value));
                }}
                aria-label="Time in the recording"
              />
              <span className="m-clock">
                Running hour {Math.round(now)}{" "}
                <span className="m-muted">of {Math.round(current.end_h)}</span>
              </span>
            </div>

            <div className="m-controls">
              <div className="m-segment" role="group" aria-label="Chart range">
                <button aria-pressed={zoom === "final"} onClick={() => setZoom("final")}>
                  Final stretch
                </button>
                <button aria-pressed={zoom === "whole"} onClick={() => setZoom("whole")}>
                  Whole test
                </button>
              </div>
              <label className="m-toggle">
                <input
                  type="checkbox"
                  checked={reveal}
                  onChange={(e) => setReveal(e.target.checked)}
                />
                Show what really happened
              </label>
            </div>

            <HealthChart
              parts={current.parts}
              selected={selected}
              now={now}
              x0={x0}
              x1={x1}
              reveal={reveal}
              onSelect={setSelected}
            />
            <p className="m-legend">
              <span className="m-key line" /> health percent · <span className="m-key dot" /> Crux
              raised the alarm
              {reveal && (
                <>
                  {" "}
                  · <span className="m-key cross">×</span> the part failed
                </>
              )}
            </p>
          </section>

          <aside className="m-sheet m-side">
            <p className="m-kicker">{focus.part.label}</p>
            <div className="m-big">
              <Battery percent={focus.percent} alarmed={focus.alarmed} big />
              <div>
                <strong>{Math.round(focus.percent)}%</strong>
                <span className={`m-chip${focus.alarmed ? " alarmed" : ""}`}>
                  {focus.alarmed ? "Needs attention" : "No alarm"}
                </span>
              </div>
            </div>
            {focus.range && (
              <p className="m-fixby">
                Fix {rangeText(focus.range)}
                {focus.range.p50_h !== null && focus.range.p50_h > 0.02 && (
                  <span className="m-muted"> · most likely {hours(focus.range.p50_h)}</span>
                )}
              </p>
            )}
            <div className="m-story">
              {story(focus, now, reveal).map((s) => (
                <p key={s}>{s}</p>
              ))}
            </div>
            <TicketPanel
              machine={current.machine}
              part={focus.part}
              now={now}
              alarmed={focus.alarmed}
              playing={playing}
            />
            <h3>Time left: Crux's range{reveal ? " vs what happened" : ""}</h3>
            <TimeLeftChart part={focus.part} now={now} reveal={reveal} />
            {focus.alarmed && (
              <p className="m-legend">
                <span className="m-key band" /> likely range · <span className="m-key mid" /> best
                guess
                {reveal && focus.part.failed && (
                  <>
                    {" "}
                    · <span className="m-key truth" /> real time left
                  </>
                )}
              </p>
            )}
            <p className="m-fine">
              The percent is not life left: a bearing can read over 75% hours before it fails, which
              is why it always comes with the alarm and a time range. Ranges come from a model that
              never saw this bearing ({focus.part.method}).
            </p>
          </aside>
        </div>
      )}
      {current && <Learning machineType="rolling bearing" />}
    </div>
  );
}

/** Machines grouped by the test they come from, in the order the API lists them. */
function groups(list: MachineSummary[]): [string, MachineSummary[]][] {
  const out = new Map<string, MachineSummary[]>();
  for (const m of list) {
    const key = m.source.split(" (")[0];
    out.set(key, [...(out.get(key) ?? []), m]);
  }
  return [...out.entries()];
}

/** "XJTU-SY run 1-1 (35Hz12kN)" -> "Run 1-1"; "NASA test rig, test 2" -> "Test 2". */
function shortName(name: string): string {
  const b = name.match(/run (\d+-\d+)/);
  if (b) return `Run ${b[1]}`;
  const t = name.match(/test (\d+)/);
  if (t) return `Test ${t[1]}`;
  const p = name.match(/pump (\d+)/i);
  return p ? `Pump ${p[1]}` : name;
}

/** How far before the first alarm the "final stretch" view starts. */
function finalLead(m: MachineReplay): number {
  return Math.min(48, m.end_h * 0.25);
}
