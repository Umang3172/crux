// Health over time, drawn by hand in SVG so every mark is one number from the
// recording: ink lines up to the plant clock, the alarm where the watcher
// fired, and a blue band for the forecast, which is a range and not a
// measurement. The failure and the rest of the series appear only on request.

import { useEffect, useRef, useState } from "react";
import type { MachineReplay, PartReplay } from "../../api/types";
import { indexAt, isOverLine, type PartNow } from "./replay";
import { useElementWidth } from "./useElementWidth";
import { hourLabel } from "./words";
import s from "./LifeChart.module.css";

const HOUR_STEPS = [0.25, 0.5, 1, 2, 3, 6, 12, 24, 48, 96, 168, 336];
const trim = (v: number) => String(Number(v.toFixed(2)));

function timeTicks(x0: number, x1: number, count: number): { v: number; label: string }[] {
  const step = HOUR_STEPS.find((h) => h >= (x1 - x0) / count) ?? HOUR_STEPS[HOUR_STEPS.length - 1];
  const out: { v: number; label: string }[] = [];
  for (let v = Math.ceil(x0 / step) * step; v <= x1 + 1e-9; v += step) {
    out.push({ v, label: step >= 24 ? `day ${trim(v / 24)}` : `${trim(v)} h` });
  }
  return out;
}

type Scale = (v: number) => number;

/** The series up to the clock, held at its last reading out to the clock itself. */
function pathUntil(part: PartReplay, to: number, x: Scale, y: Scale): string {
  const pts: string[] = [];
  for (let i = 0; i < part.t_h.length && part.t_h[i] <= to; i++) {
    pts.push(`${x(part.t_h[i]).toFixed(1)} ${y(part.percent[i]).toFixed(1)}`);
  }
  if (!pts.length) return "";
  pts.push(`${x(to).toFixed(1)} ${y(part.percent[indexAt(part.t_h, to)]).toFixed(1)}`);
  return `M${pts.join("L")}`;
}

/** What happened after the clock: drawn only when the visitor asks. */
function pathAfter(part: PartReplay, from: number, x: Scale, y: Scale): string {
  const pts = [`${x(from).toFixed(1)} ${y(part.percent[indexAt(part.t_h, from)]).toFixed(1)}`];
  for (let i = 0; i < part.t_h.length; i++) {
    if (part.t_h[i] > from) pts.push(`${x(part.t_h[i]).toFixed(1)} ${y(part.percent[i]).toFixed(1)}`);
  }
  return pts.length > 1 ? `M${pts.join("L")}` : "";
}

export function LifeChart({
  replay,
  parts,
  focusId,
  now,
  domain,
  revealed,
  reduceMotion,
}: {
  replay: MachineReplay;
  parts: PartNow[];
  focusId: string;
  now: number;
  domain: [number, number];
  revealed: boolean;
  reduceMotion: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const width = useElementWidth(box, 880);
  const compact = width < 560;
  const height = compact ? 280 : 360;
  const m = compact ? { l: 40, r: 10, t: 32, b: 30 } : { l: 50, r: 18, t: 34, b: 34 };
  const pw = Math.max(80, width - m.l - m.r);
  const ph = height - m.t - m.b;
  const [x0, x1] = domain;
  const x: Scale = (t) => m.l + ((t - x0) / (x1 - x0)) * pw;
  const y: Scale = (p) => m.t + (1 - p / 100) * ph;
  const clampX = (v: number) => Math.min(m.l + pw, Math.max(m.l, v));
  const inside = (t: number) => t >= x0 && t <= x1;

  const focus = parts.find((p) => p.part.part === focusId) ?? parts[0];
  const others = parts.filter((p) => p !== focus);
  const alarm = focus.part.alarm_h;

  // The alarm flag drops when the clock crosses the alarm, not when the page opens.
  const [drops, setDrops] = useState(0);
  const was = useRef(focus.alarmed);
  useEffect(() => {
    if (focus.alarmed && !was.current) setDrops((n) => n + 1);
    was.current = focus.alarmed;
  }, [focus.alarmed]);

  const r = focus.range;
  // The range was given at `r.at_h`, the latest forecast at or before the clock, so the band hangs from that hour.
  const band =
    r && r.p10_h !== null && r.p90_h !== null && !isOverLine(r)
      ? {
          left: clampX(x(r.at_h + r.p10_h)),
          right: clampX(x(r.at_h + r.p90_h)),
          mid: r.p50_h !== null ? x(r.at_h + r.p50_h) : null,
          // A range that runs past the chart says so rather than ending at its edge.
          clipped: x(r.at_h + r.p90_h) > m.l + pw,
        }
      : null;

  const flagText = alarm !== null ? `ALARM · ${hourLabel(alarm).toUpperCase()}` : "";
  const flagW = flagText.length * 7.2 + 18;
  const flagLeft = alarm !== null && x(alarm) - flagW >= m.l;
  // Right of the line it would sit on the forecast's label, so it drops below it.
  const flagTop = flagLeft ? 6 : 30;
  const label = `Health of each part of ${replay.name} over time. At running hour ${trim(now)} the part in focus reads ${Math.round(focus.percent)}%${focus.alarmed ? " and the alarm has fired" : ""}.`;

  return (
    <div className={s.wrap} ref={box} style={{ height }}>
      <svg className={s.svg} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        <defs>
          <clipPath id="life-plot">
            <rect x={m.l} y={m.t - 1} width={pw} height={ph + 2} />
          </clipPath>
        </defs>

        {[0, 25, 50, 75, 100].map((p) => (
          <g key={p}>
            <line className={p === 0 ? s.floor : s.grid} x1={m.l} x2={m.l + pw} y1={y(p)} y2={y(p)} />
            <text className={s.tick} x={m.l - 8} y={y(p) + 4} textAnchor="end">
              {p}%
            </text>
          </g>
        ))}
        <text className={s.note} x={m.l + 6} y={y(0) - 7}>
          danger line
        </text>
        {timeTicks(x0, x1, compact ? 4 : 7).map(({ v, label: t }) => (
          <g key={v}>
            <line className={s.floor} x1={x(v)} x2={x(v)} y1={y(0)} y2={y(0) + 5} />
            <text className={s.tick} x={x(v)} y={height - 8} textAnchor="middle">
              {t}
            </text>
          </g>
        ))}

        {band && (
          <g aria-hidden="true">
            <rect className={s.band} x={band.left} y={m.t} width={Math.max(2, band.right - band.left)} height={ph} />
            <line className={s.bandEdge} x1={band.left} x2={band.left} y1={m.t} y2={m.t + ph} />
            <line className={s.bandEdge} x1={band.right} x2={band.right} y1={m.t} y2={m.t + ph} />
            {band.mid !== null && band.mid <= m.l + pw && <line className={s.mid} x1={band.mid} x2={band.mid} y1={m.t} y2={m.t + ph} />}
            {band.clipped && <path className={s.more} d={`M${band.right - 12} ${m.t + ph / 2 - 8}l12 8l-12 8z`} />}
            <text className={s.bandLabel} x={band.left + 6} y={m.t + 18}>
              Forecast
            </text>
          </g>
        )}

        <g clipPath="url(#life-plot)">
          {revealed && parts.map((p) => <path key={`g-${p.part.part}`} className={s.ghost} d={pathAfter(p.part, now, x, y)} />)}
          {others.map((p) => (
            <path key={p.part.part} className={s.line} d={pathUntil(p.part, now, x, y)} />
          ))}
          <path className={s.focus} d={pathUntil(focus.part, now, x, y)} />
        </g>

        {parts.map(
          (p) =>
            p.alarmed &&
            p.part.alarm_h !== null &&
            inside(p.part.alarm_h) && (
              <circle key={`a-${p.part.part}`} className={s.dot} cx={x(p.part.alarm_h)} cy={y(p.part.percent[indexAt(p.part.t_h, p.part.alarm_h)])} r={p === focus ? 5 : 3.5} />
            ),
        )}

        {focus.alarmed && alarm !== null && inside(alarm) && (
          <g key={drops} className={drops > 0 && !reduceMotion ? s.drop : undefined}>
            <line className={s.alarmLine} x1={x(alarm)} x2={x(alarm)} y1={m.t} y2={m.t + ph} />
            <rect className={s.alarmFlag} x={flagLeft ? x(alarm) - flagW : x(alarm)} y={m.t + flagTop} width={flagW} height={20} />
            <text className={s.alarmText} x={flagLeft ? x(alarm) - 9 : x(alarm) + 9} y={m.t + flagTop + 14} textAnchor={flagLeft ? "end" : "start"}>
              {flagText}
            </text>
          </g>
        )}

        {revealed &&
          replay.parts.map(
            (p) =>
              p.failed &&
              inside(p.end_h) && (
                <g key={`f-${p.part}`}>
                  <path className={s.fail} d={`M${x(p.end_h) - 6} ${y(0) - 6}l12 12M${x(p.end_h) + 6} ${y(0) - 6}l-12 12`} />
                  {p.part === focus.part.part && (
                    <text className={s.failText} x={x(p.end_h) + 12} y={y(0) - 14}>
                      Failed · hour {trim(p.end_h)}
                    </text>
                  )}
                </g>
              ),
          )}

        {inside(now) && (
          <g aria-hidden="true">
            <line className={s.nowLine} x1={x(now)} x2={x(now)} y1={m.t - 2} y2={m.t + ph} />
            <rect className={s.nowFlag} x={x(now) - 20} y={m.t - 24} width={40} height={18} />
            <text className={s.nowText} x={x(now)} y={m.t - 11} textAnchor="middle">
              NOW
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
