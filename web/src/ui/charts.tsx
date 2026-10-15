// Charts, drawn in SVG at the pixel size of their container. Each takes the
// server's numbers as they are; none smooths, fits or invents a point.

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion, useWidth } from "../lib/hooks";
import { num, pct, signed } from "../lib/format";

const TONE_VAR: Record<string, string> = {
  text: "var(--text)",
  muted: "var(--text-3)",
  accent: "var(--accent)",
  sim: "var(--sim)",
  model: "var(--model)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
};

function ticks(min: number, max: number, target: number): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

const path = (xs: number[], ys: number[]) => xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join("");

export function Sparkline({ values, tone = "accent", height = 28, width = 96 }: { values: number[]; tone?: string; height?: number; width?: number }) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xs = values.map((_, i) => (i / (values.length - 1)) * width);
  const ys = values.map((v) => height - 2 - ((v - min) / span) * (height - 4));
  return (
    <svg width={width} height={height} aria-hidden>
      <path d={path(xs, ys)} fill="none" stroke={TONE_VAR[tone]} strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  );
}

/** A raw vibration trace about its zero line. */
export function Waveform({ values, height = 72 }: { values: number[]; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const d = useMemo(() => {
    if (!w || values.length < 2) return "";
    const peak = Math.max(...values.map(Math.abs)) || 1;
    const xs = values.map((_, i) => (i / (values.length - 1)) * w);
    const ys = values.map((v) => height / 2 - (v / peak) * (height / 2 - 3));
    return path(xs, ys);
  }, [values, w, height]);
  return (
    <div ref={ref} className="chart">
      <svg width={w} height={height} role="img" aria-label="Vibration waveform">
        <line x1={0} x2={w} y1={height / 2} y2={height / 2} stroke="var(--line)" />
        <path d={d} fill="none" stroke="var(--text-2)" strokeWidth={1} />
      </svg>
    </div>
  );
}

export type Series = { id: string; label: string; values: number[]; tone: string; fill?: boolean; dashed?: boolean };
export type Marker = { hz: number; label: string };

/** Two or more spectra on one frequency axis, with the predicted lines marked. */
export function SpectrumChart({
  freq,
  series,
  markers = [],
  height = 240,
  unit = "Hz",
}: {
  freq: number[];
  series: Series[];
  markers?: Marker[];
  height?: number;
  unit?: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 44, r: 12, t: 22, b: 26 };
  const iw = Math.max(0, w - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const xMax = freq[freq.length - 1] ?? 1;
  const yMax = Math.max(1e-9, ...series.flatMap((s) => s.values)) * 1.08;
  const x = (hz: number) => pad.l + (hz / xMax) * iw;
  const y = (v: number) => pad.t + ih - (v / yMax) * ih;
  const xs = freq.map(x);
  const shown = markers.filter((m) => m.hz > 0 && m.hz <= xMax);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const hz = ((e.clientX - rect.left - pad.l) / iw) * xMax;
    if (hz < 0 || hz > xMax) return setHover(null);
    let best = 0;
    for (let i = 1; i < freq.length; i++) if (Math.abs(freq[i] - hz) < Math.abs(freq[best] - hz)) best = i;
    setHover(best);
  }

  return (
    <div ref={ref} className="chart">
      {w > 0 && (
        <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Spectrum">
          {ticks(0, yMax, 4).map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
              <text x={pad.l - 8} y={y(t) + 3.5} textAnchor="end" className="chart-tick">
                {num(t, t < 10 ? 1 : 0)}
              </text>
            </g>
          ))}
          {ticks(0, xMax, 8).map((t) => (
            <text key={t} x={x(t)} y={height - 8} textAnchor="middle" className="chart-tick">
              {t}
            </text>
          ))}
          <text x={w - pad.r} y={height - 8} textAnchor="end" className="chart-tick">
            {unit}
          </text>
          {shown.map((m, i) => (
            <g key={`${m.label}-${i}`}>
              <line x1={x(m.hz)} x2={x(m.hz)} y1={pad.t - 4} y2={pad.t + ih} stroke="var(--line-2)" strokeDasharray="3 3" />
              <text x={x(m.hz)} y={pad.t - 8} textAnchor="middle" className="chart-mark">
                {m.label}
              </text>
            </g>
          ))}
          {series.map((s) => {
            const ys = s.values.map(y);
            const line = path(xs, ys);
            return (
              <g key={s.id}>
                {s.fill && <path d={`${line}L${xs[xs.length - 1]} ${pad.t + ih}L${xs[0]} ${pad.t + ih}Z`} fill={TONE_VAR[s.tone]} opacity={0.1} />}
                <path d={line} fill="none" stroke={TONE_VAR[s.tone]} strokeWidth={1.5} strokeLinejoin="round" strokeDasharray={s.dashed ? "4 3" : undefined} />
              </g>
            );
          })}
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={xs[hover]} x2={xs[hover]} y1={pad.t} y2={pad.t + ih} stroke="var(--text-3)" />
              {series.map((s) => (
                <circle key={s.id} cx={xs[hover]} cy={y(s.values[hover])} r={3} fill={TONE_VAR[s.tone]} stroke="var(--panel)" />
              ))}
            </g>
          )}
        </svg>
      )}
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.id} className="chart-key">
            <i style={{ background: TONE_VAR[s.tone] }} />
            {s.label}
            {hover !== null && <b className="num">{num(s.values[hover], 2)}</b>}
          </span>
        ))}
        <span className="push dim num">{hover !== null ? `${num(freq[hover], 0)} ${unit}` : "Hover to read a frequency"}</span>
      </div>
    </div>
  );
}

export type Expected = { kind: string; label: string; value: number; tone?: string; faded?: boolean };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** A number that glides to its new value, so a change is seen. It jumps when motion is reduced. */
function useGlide(target: number, ms: number): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(target);
  const at = useRef(target);
  useEffect(() => {
    const start = at.current;
    if (reduced || Math.abs(start - target) < 1e-4) {
      at.current = target;
      setShown(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      at.current = start + (target - start) * (1 - (1 - k) ** 3);
      setShown(at.current);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return shown;
}

/** One suspect's belief beside its prediction: a bar against the verdict's bar, and where it stood before the last reading. */
function BeliefMark({ x, width, cy, value, was, bar, tone, textX, bare, strong }: { x: number; width: number; cy: number; value: number; was?: number | null; bar?: number; tone: string; textX: number; bare: boolean; strong: boolean }) {
  const v = useGlide(value, 560);
  const moved = was !== null && was !== undefined && Math.abs(was - value) >= 0.005;
  return (
    <g>
      {!bare && (
        <>
          <rect x={x} y={cy - 3} width={width} height={6} rx={3} fill="var(--panel-3)" />
          {moved && <rect x={x + clamp01(Math.min(was, v)) * width} y={cy - 3} width={Math.abs(clamp01(was) - clamp01(v)) * width} height={6} fill="var(--text-3)" opacity={0.28} />}
          <rect x={x} y={cy - 3} width={clamp01(v) * width} height={6} rx={3} style={{ fill: TONE_VAR[tone], transition: "fill 320ms" }} />
          {moved && (
            <line x1={x + clamp01(was) * width} x2={x + clamp01(was) * width} y1={cy - 6} y2={cy + 6} stroke="var(--text-3)" strokeWidth={1.5} strokeLinecap="round">
              <title>Before the last reading: {pct(was)}</title>
            </line>
          )}
          {bar !== undefined && (
            <line x1={x + bar * width} x2={x + bar * width} y1={cy - 7} y2={cy + 7} stroke="var(--text-2)" strokeWidth={2} strokeLinecap="round">
              <title>A verdict needs {pct(bar)}</title>
            </line>
          )}
        </>
      )}
      <text x={textX} y={cy + 4} textAnchor="end" className="chart-value" style={strong ? { fill: "var(--text)", fontWeight: 650 } : undefined}>
        {pct(v)}
      </text>
    </g>
  );
}

/**
 * What each suspect predicts the requested measurement will read, with the
 * measurement's own spread, and where the reading landed once it came back.
 * Given beliefs, each row also carries that suspect's belief against the bar a
 * verdict needs, so a reading and what it did to the beliefs are seen together.
 * Every number drawn is the server's.
 */
export function DecisionAxis({
  expected,
  sigma,
  reading,
  readingLabel,
  beliefs,
  was,
  bar,
  leader,
  settled,
  land,
}: {
  expected: Expected[];
  sigma: number;
  reading?: number | null;
  readingLabel?: string;
  /** Each suspect's belief, 0 to 1. It glides when it changes. */
  beliefs?: Record<string, number | null | undefined>;
  /** Each suspect's belief before the last reading, marked faintly. */
  was?: Record<string, number | null | undefined>;
  /** The belief a verdict needs. */
  bar?: number;
  /** The suspect in the lead: its row is drawn strong. */
  leader?: string | null;
  /** The leader has been named as the cause. */
  settled?: boolean;
  /** Draw the reading arriving: the moment it is handed in. */
  land?: boolean;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const narrow = w > 0 && w < 540;
  const withBeliefs = !!beliefs;
  const rowH = narrow ? 50 : 36;
  const pad = narrow ? { t: 30, b: 26 } : { t: 44, b: 26 };
  const labelW = narrow ? 0 : Math.min(196, Math.max(132, w * 0.25));
  const beliefW = withBeliefs && !narrow ? Math.min(220, Math.max(150, w * 0.26)) : 0;
  const x0 = narrow ? 6 : labelW + 6;
  const x1 = narrow ? w - 10 : withBeliefs ? w - beliefW - 24 : w - 16;
  const values = expected.map((e) => e.value).concat(reading ?? []);
  const lo = Math.min(...values) - 2 * sigma;
  const hi = Math.max(...values) + 2 * sigma;
  const x = (v: number) => x0 + ((v - lo) / (hi - lo || 1)) * Math.max(0, x1 - x0);
  const height = pad.t + expected.length * rowH + pad.b;
  const base = pad.t + expected.length * rowH;
  const trackX = w - beliefW + 4;
  const trackW = Math.max(0, beliefW - 52);
  const xr = reading === null || reading === undefined ? null : x(reading);
  const labelLeft = xr !== null && xr > x1 - 110;

  return (
    <div ref={ref} className="chart">
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label="What each suspect predicts this measurement will read">
          {!narrow && (
            <g className="chart-tick" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
              <text x={0} y={12}>
                Suspect
              </text>
              <text x={(x0 + x1) / 2} y={12} textAnchor="middle">
                Predicted reading
              </text>
              {withBeliefs && (
                <text x={trackX} y={12}>
                  Belief
                </text>
              )}
            </g>
          )}
          {ticks(lo, hi, narrow ? 4 : 6).map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={pad.t - 4} y2={base} stroke="var(--line)" />
              <text x={x(t)} y={base + 16} textAnchor="middle" className="chart-tick">
                {signed(t, 1)}
              </text>
            </g>
          ))}
          {expected.map((e, i) => {
            const top = pad.t + i * rowH;
            const cy = narrow ? top + 33 : top + rowH / 2;
            const ly = narrow ? top + 15 : cy + 4;
            const colour = TONE_VAR[e.tone ?? "text"];
            const lead = !!leader && e.kind === leader;
            const vx = x(e.value + sigma) + 6;
            const valueLeft = vx + 34 > x1;
            return (
              <g key={e.kind}>
                <rect x={0} y={top + 2} width={w} height={rowH - 4} rx={6} fill="var(--ok-soft)" opacity={settled && lead ? 1 : 0} style={{ transition: "opacity 420ms" }} />
                <g opacity={e.faded ? 0.45 : 1}>
                  <text x={narrow ? 0 : 0} y={ly} className="chart-label" style={lead ? { fontWeight: 680 } : undefined}>
                    {e.label}
                  </text>
                  <rect x={x(e.value - sigma)} y={cy - 7} width={Math.max(1, x(e.value + sigma) - x(e.value - sigma))} height={14} rx={3} fill={colour} opacity={0.16} />
                  <line x1={x(e.value - sigma)} x2={x(e.value + sigma)} y1={cy} y2={cy} stroke={colour} strokeWidth={1.5} />
                  <circle cx={x(e.value)} cy={cy} r={4.5} fill={colour} stroke="var(--panel)" strokeWidth={1.5} />
                  <text x={valueLeft ? x(e.value - sigma) - 6 : vx} y={cy + 4} textAnchor={valueLeft ? "end" : "start"} className="chart-value">
                    {signed(e.value, 2)}
                  </text>
                  {beliefs && (
                    <BeliefMark
                      x={trackX}
                      width={trackW}
                      cy={narrow ? ly - 4 : cy}
                      value={beliefs[e.kind] ?? 0}
                      was={was?.[e.kind]}
                      bar={bar}
                      tone={lead ? (settled ? "ok" : "accent") : "muted"}
                      textX={w}
                      bare={narrow}
                      strong={lead}
                    />
                  )}
                </g>
              </g>
            );
          })}
          {xr !== null && reading !== null && reading !== undefined && (
            <g className={land ? "axis-read land" : "axis-read"}>
              <line x1={xr} x2={xr} y1={pad.t - 4} y2={base} stroke="var(--text)" strokeWidth={2} pathLength={1} className="axis-read-line" />
              <path d={`M${xr} ${pad.t - 15}l5 5l-5 5l-5 -5z`} fill="var(--text)" className="axis-read-head" />
              {land && <circle cx={xr} cy={pad.t - 10} r={6} fill="none" stroke="var(--text)" strokeWidth={1.5} className="axis-read-ring" />}
              <text x={xr} y={pad.t - 20} textAnchor={labelLeft ? "end" : "start"} dx={labelLeft ? -8 : 8} className="chart-value axis-read-label" style={{ fill: "var(--text)", fontWeight: 650 }}>
                {readingLabel ?? "reading"} {signed(reading, 2)}
              </text>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

export type Band = { at: number; lo: number; mid: number; hi: number };

/** A part's health over its running hours, drawn only up to the clock unless the whole run is revealed. */
export function LifeChart({
  t,
  percent,
  now,
  alarm,
  band,
  end,
  whole,
  height = 260,
}: {
  t: number[];
  percent: number[];
  now: number;
  alarm: number | null;
  band: Band | null;
  end: number;
  whole: boolean;
  height?: number;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const pad = { l: 44, r: 16, t: 22, b: 26 };
  const iw = Math.max(0, w - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const xMax = Math.max(end, band ? band.at + band.hi : 0, now) * 1.02;
  const x = (h: number) => pad.l + (h / xMax) * iw;
  const y = (p: number) => pad.t + ih - (Math.max(0, Math.min(100, p)) / 100) * ih;
  const upTo = whole ? Infinity : now;
  const pts = t.map((h, i) => ({ h, p: percent[i] })).filter((p) => p.h <= upTo);
  const line = path(
    pts.map((p) => x(p.h)),
    pts.map((p) => y(p.p)),
  );
  return (
    <div ref={ref} className="chart">
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label="Health over running hours">
          {[0, 25, 50, 75, 100].map((p) => (
            <g key={p}>
              <line x1={pad.l} x2={w - pad.r} y1={y(p)} y2={y(p)} stroke={p === 0 ? "var(--danger-line)" : "var(--line)"} />
              <text x={pad.l - 8} y={y(p) + 3.5} textAnchor="end" className="chart-tick">
                {p}%
              </text>
            </g>
          ))}
          {ticks(0, xMax, 8).map((h) => (
            <text key={h} x={x(h)} y={height - 8} textAnchor="middle" className="chart-tick">
              {h} h
            </text>
          ))}
          {band && (
            <g>
              <rect x={x(band.at + band.lo)} y={pad.t} width={Math.max(2, x(band.at + band.hi) - x(band.at + band.lo))} height={ih} fill="var(--accent)" opacity={0.1} />
              <line x1={x(band.at + band.mid)} x2={x(band.at + band.mid)} y1={pad.t} y2={pad.t + ih} stroke="var(--accent)" strokeDasharray="4 3" />
              <text x={x(band.at + band.mid)} y={alarm !== null && alarm <= upTo && Math.abs(x(band.at + band.mid) - x(alarm)) < 52 ? pad.t + 12 : pad.t - 8} textAnchor="middle" className="chart-mark" fill="var(--accent)">
                forecast
              </text>
            </g>
          )}
          {alarm !== null && alarm <= upTo && (
            <g>
              <line x1={x(alarm)} x2={x(alarm)} y1={pad.t} y2={pad.t + ih} stroke="var(--warn)" />
              <text x={x(alarm)} y={pad.t - 8} textAnchor="middle" className="chart-mark" fill="var(--warn)">
                alarm
              </text>
            </g>
          )}
          <path d={line} fill="none" stroke="var(--text)" strokeWidth={1.8} strokeLinejoin="round" />
          {!whole && (
            <g>
              <line x1={x(now)} x2={x(now)} y1={pad.t} y2={pad.t + ih} stroke="var(--text-3)" strokeDasharray="2 3" />
              {pts.length > 0 && <circle cx={x(pts[pts.length - 1].h)} cy={y(pts[pts.length - 1].p)} r={4} fill="var(--text)" stroke="var(--panel)" strokeWidth={1.5} />}
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

export type Part = { label: string; value: number; tone: string };

/** Counts as one stacked bar: how a set of cases split. */
export function StackBar({ parts, height = 10 }: { parts: Part[]; height?: number }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div className="stack" style={{ height }} role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(", ")}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: TONE_VAR[p.tone] }} title={`${p.label}: ${p.value}`} />
        ))}
    </div>
  );
}
