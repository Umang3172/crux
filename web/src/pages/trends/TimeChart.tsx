// One time axis, drawn in SVG at the pixel size of its container: history,
// a forecast band, what really happened, flagged points, the leak windows and
// the "as of" line. It draws the server's numbers as they are: a null breaks
// the line, nothing is smoothed or filled in.

import { useMemo, useState, type PointerEvent } from "react";
import { useWidth } from "../../lib/hooks";

const TONE: Record<string, string> = {
  text: "var(--text)",
  muted: "var(--text-3)",
  accent: "var(--accent)",
  model: "var(--model)",
  sim: "var(--sim)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
};
const tone = (t: string) => TONE[t] ?? t;

export type ChartLine = { id: string; label: string; t: number[]; v: (number | null)[]; tone: string; dashed?: boolean; width?: number };
export type ChartBand = { id: string; label: string; t: number[]; lo: (number | null)[]; hi: (number | null)[]; tone: string };
export type ChartDot = { t: number; v: number; tone: string };
export type ChartWindow = { start: number; end: number; label?: string };

type Props = {
  title?: string;
  unit?: string;
  lines: ChartLine[];
  bands?: ChartBand[];
  dots?: ChartDot[];
  windows?: ChartWindow[];
  asOf?: number | null;
  /** Times are a run's own clock: label them as hours from `origin` (default: the first point). */
  relative?: boolean;
  origin?: number | null;
  height?: number;
  /** Fix the lower edge of the y axis (a share or a current never goes below 0). */
  floor?: number;
  label: string;
};

function niceTicks(min: number, max: number, target: number): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

const HOUR = 3600;
const DAY = 24 * HOUR;
const STEPS = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY];

/** Ticks on whole clock hours or days, in the recording's own clock (UTC). */
function timeTicks(min: number, max: number, target: number): number[] {
  // Past two days a tick falls on midnight only, so no date is printed twice.
  const steps = max - min > 2 * DAY ? STEPS.filter((s) => s % DAY === 0) : STEPS;
  const step = steps.find((s) => (max - min) / s <= target) ?? 14 * DAY;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
  return out;
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts });
const dayFmt = fmt({ day: "numeric", month: "short" });
const timeFmt = fmt({ hour: "2-digit", minute: "2-digit" });
const fullFmt = fmt({ weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const dateFmt = fmt({ weekday: "short", day: "numeric", month: "short" });
export const dayLabel = (t: number) => dateFmt.format(new Date(t * 1000));

export function whenLabel(t: number, relative = false, t0 = 0): string {
  if (relative) return `${((t - t0) / HOUR).toFixed(1)} h`;
  return fullFmt.format(new Date(t * 1000));
}

function tickLabel(t: number, span: number, relative: boolean, t0: number): string {
  if (relative) return `${Math.round((t - t0) / HOUR)} h`;
  const d = new Date(t * 1000);
  if (span <= 2 * DAY) return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? dayFmt.format(d) : timeFmt.format(d);
  return dayFmt.format(d);
}

function runs(t: number[], v: (number | null)[], x: (t: number) => number, y: (v: number) => number): string {
  let d = "";
  let pen = false;
  for (let i = 0; i < t.length; i++) {
    const val = v[i];
    if (val === null || val === undefined || !Number.isFinite(val)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x(t[i]).toFixed(1)} ${y(val).toFixed(1)}`;
    pen = true;
  }
  return d;
}

function area(b: ChartBand, x: (t: number) => number, y: (v: number) => number): string {
  const pts = b.t.map((t, i) => [t, b.lo[i], b.hi[i]] as const).filter(([, lo, hi]) => lo !== null && hi !== null) as [number, number, number][];
  if (!pts.length) return "";
  const top = pts.map(([t, , hi], i) => `${i ? "L" : "M"}${x(t).toFixed(1)} ${y(hi).toFixed(1)}`).join("");
  const bottom = [...pts].reverse().map(([t, lo]) => `L${x(t).toFixed(1)} ${y(lo).toFixed(1)}`).join("");
  return `${top}${bottom}Z`;
}

const nearest = (ts: number[], t: number) => {
  let lo = 0;
  let hi = ts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] < t) lo = mid;
    else hi = mid;
  }
  return Math.abs(ts[lo] - t) <= Math.abs(ts[hi] - t) ? lo : hi;
};

export function TimeChart({ title, unit = "", lines, bands = [], dots = [], windows = [], asOf = null, relative = false, origin = null, height = 180, floor, label }: Props) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 44, r: 12, t: title ? 22 : 10, b: 22 };
  const iw = Math.max(0, w - pad.l - pad.r);
  const ih = height - pad.t - pad.b;

  const dom = useMemo(() => {
    let tMin = Infinity;
    let tMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    const seeT = (t: number) => {
      tMin = Math.min(tMin, t);
      tMax = Math.max(tMax, t);
    };
    const seeV = (v: number | null) => {
      if (v === null || !Number.isFinite(v)) return;
      vMin = Math.min(vMin, v);
      vMax = Math.max(vMax, v);
    };
    for (const l of lines) {
      l.t.forEach(seeT);
      l.v.forEach(seeV);
    }
    for (const b of bands) {
      b.t.forEach(seeT);
      b.lo.forEach(seeV);
      b.hi.forEach(seeV);
    }
    if (floor !== undefined) vMin = Math.min(vMin, floor);
    if (!Number.isFinite(vMin)) {
      vMin = 0;
      vMax = 1;
    }
    const padV = (vMax - vMin) * 0.06 || 1;
    return { tMin, tMax, vMin: floor !== undefined && vMin >= floor ? floor : vMin - padV, vMax: vMax + padV };
  }, [lines, bands, floor]);

  const x = (t: number) => pad.l + ((t - dom.tMin) / Math.max(1, dom.tMax - dom.tMin)) * iw;
  const y = (v: number) => pad.t + ih - ((v - dom.vMin) / (dom.vMax - dom.vMin)) * ih;
  const span = dom.tMax - dom.tMin;
  const t0 = origin ?? dom.tMin;
  const xt = relative
    ? niceTicks((dom.tMin - t0) / HOUR, (dom.tMax - t0) / HOUR, Math.max(3, Math.floor(iw / 80))).map((h) => t0 + h * HOUR)
    : timeTicks(dom.tMin, dom.tMax, Math.max(2, Math.floor(iw / 80)));
  const yt = niceTicks(dom.vMin, dom.vMax, 4);
  const allT = useMemo(() => [...new Set(lines.flatMap((l) => l.t).concat(bands.flatMap((b) => b.t)))].sort((a, b) => a - b), [lines, bands]);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!allT.length || iw <= 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const t = dom.tMin + ((e.clientX - r.left - pad.l) / iw) * (dom.tMax - dom.tMin);
    setHover(allT[nearest(allT, t)]);
  };

  const readout = hover === null
    ? []
    : [
        ...lines.map((l) => {
          const i = l.t.indexOf(hover);
          return i < 0 || l.v[i] === null ? null : { label: l.label, value: l.v[i] as number, tone: l.tone };
        }),
        ...bands.map((b) => {
          const i = b.t.indexOf(hover);
          return i < 0 || b.lo[i] === null ? null : { label: b.label, value: NaN, range: [b.lo[i] as number, b.hi[i] as number], tone: b.tone };
        }),
      ].filter(Boolean) as { label: string; value: number; range?: [number, number]; tone: string }[];

  const f = (v: number) => (Number.isInteger(v) ? String(v) : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

  return (
    <div ref={ref} className="chart tc">
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {title && (
            <text x={pad.l} y={12} className="chart-label">
              {title}
              {unit && <tspan className="chart-tick"> {unit}</tspan>}
            </text>
          )}
          {windows.map((wd, i) => {
            const a = Math.max(dom.tMin, wd.start);
            const b = Math.min(dom.tMax, wd.end);
            if (b <= a) return null;
            return (
              <g key={i}>
                <rect x={x(a)} y={pad.t} width={Math.max(2, x(b) - x(a))} height={ih} className="tc-window" />
                {wd.label && (
                  <text x={x(a) + 4} y={pad.t + 11} className="chart-mark tc-window-label">
                    {wd.label}
                  </text>
                )}
              </g>
            );
          })}
          {yt.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
              <text x={pad.l - 6} y={y(v) + 3.5} textAnchor="end" className="chart-tick">
                {f(v)}
              </text>
            </g>
          ))}
          {xt.map((t) => (
            <text key={t} x={x(t)} y={height - 6} textAnchor="middle" className="chart-tick">
              {tickLabel(t, span, relative, t0)}
            </text>
          ))}
          {bands.map((b) => (
            <path key={b.id} d={area(b, x, y)} fill={tone(b.tone)} opacity={0.16} />
          ))}
          {lines.map((l) => (
            <path
              key={l.id}
              d={runs(l.t, l.v, x, y)}
              fill="none"
              stroke={tone(l.tone)}
              strokeWidth={l.width ?? 1.6}
              strokeDasharray={l.dashed ? "4 3" : undefined}
              strokeLinejoin="round"
            />
          ))}
          {dots.map((d, i) => (
            <circle key={i} cx={x(d.t)} cy={y(d.v)} r={2.6} fill={tone(d.tone)} stroke="var(--panel)" strokeWidth={0.8} />
          ))}
          {asOf !== null && asOf >= dom.tMin && asOf <= dom.tMax && (
            <g>
              <line x1={x(asOf)} x2={x(asOf)} y1={pad.t} y2={pad.t + ih} stroke="var(--text-2)" strokeDasharray="2 3" />
              <text x={x(asOf) - 4} y={pad.t + 10} textAnchor="end" className="chart-mark">
                as of
              </text>
            </g>
          )}
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--text-3)" strokeWidth={1} />
          )}
        </svg>
      )}
      <div className="tc-read mono" aria-live="polite">
        {hover !== null && readout.length > 0 && (
          <>
            <span className="muted">{whenLabel(hover, relative, t0)}</span>
            {readout.map((r) => (
              <span key={r.label}>
                <i style={{ background: tone(r.tone) }} />
                {r.label} {r.range ? `${f(r.range[0])}–${f(r.range[1])}` : f(r.value)}
                {unit && ` ${unit}`}
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; tone: string; kind?: "line" | "band" | "dash" | "dot" | "window" }[] }) {
  return (
    <div className="chart-legend">
      {items.map((it) => (
        <span key={it.label} className={`chart-key tc-key-${it.kind ?? "line"}`}>
          <i style={{ background: it.kind === "window" ? undefined : tone(it.tone) }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
