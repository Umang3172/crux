// Charts, drawn in SVG at the pixel size of their container. Each takes the
// server's numbers as they are; none smooths, fits or invents a point.

import { useMemo, useState } from "react";
import { useWidth } from "../lib/hooks";
import { num, signed } from "../lib/format";

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

/**
 * What each suspect predicts the requested measurement will read, with the
 * measurement's own spread, and where the reading landed once it came back.
 */
export function DecisionAxis({ expected, sigma, reading, readingLabel }: { expected: Expected[]; sigma: number; reading?: number | null; readingLabel?: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const rowH = 30;
  const labelW = Math.min(210, Math.max(120, w * 0.3));
  const pad = { r: 16, t: 24, b: 26 };
  const values = expected.map((e) => e.value).concat(reading ?? []);
  const lo = Math.min(...values) - 2 * sigma;
  const hi = Math.max(...values) + 2 * sigma;
  const iw = Math.max(0, w - labelW - pad.r);
  const x = (v: number) => labelW + ((v - lo) / (hi - lo || 1)) * iw;
  const height = pad.t + expected.length * rowH + pad.b;
  const base = pad.t + expected.length * rowH;

  return (
    <div ref={ref} className="chart">
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label="What each suspect predicts this measurement will read">
          {ticks(lo, hi, 6).map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={pad.t - 4} y2={base} stroke="var(--line)" />
              <text x={x(t)} y={base + 16} textAnchor="middle" className="chart-tick">
                {signed(t, 1)}
              </text>
            </g>
          ))}
          {expected.map((e, i) => {
            const cy = pad.t + i * rowH + rowH / 2;
            const colour = TONE_VAR[e.tone ?? "text"];
            return (
              <g key={e.kind} opacity={e.faded ? 0.45 : 1}>
                <text x={0} y={cy + 4} className="chart-label">
                  {e.label}
                </text>
                <rect x={x(e.value - sigma)} y={cy - 7} width={Math.max(1, x(e.value + sigma) - x(e.value - sigma))} height={14} rx={3} fill={colour} opacity={0.16} />
                <line x1={x(e.value - sigma)} x2={x(e.value + sigma)} y1={cy} y2={cy} stroke={colour} strokeWidth={1.5} />
                <circle cx={x(e.value)} cy={cy} r={4.5} fill={colour} stroke="var(--panel)" strokeWidth={1.5} />
                <text x={x(e.value + sigma) + 6} y={cy + 4} className="chart-value">
                  {signed(e.value, 2)}
                </text>
              </g>
            );
          })}
          {reading !== null && reading !== undefined && (
            <g>
              <line x1={x(reading)} x2={x(reading)} y1={pad.t - 6} y2={base} stroke="var(--ok)" strokeWidth={2} />
              <rect x={x(reading) - 3} y={pad.t - 12} width={6} height={6} fill="var(--ok)" transform={`rotate(45 ${x(reading)} ${pad.t - 9})`} />
              <text x={Math.min(w - 4, Math.max(labelW, x(reading)))} y={11} textAnchor={x(reading) > w - 120 ? "end" : "start"} dx={x(reading) > w - 120 ? -8 : 8} className="chart-read">
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
              <text x={x(band.at + band.mid)} y={pad.t - 8} textAnchor="middle" className="chart-mark" fill="var(--accent)">
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
