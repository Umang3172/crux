// How far the housing moves at each frequency, from the clip itself. The
// marked lines are where the shaft speed puts one, two, three turns per
// second; a line the frame rate folds back is drawn where the camera sees it.

import type { ScanAnalysis } from "../../api/types";
import { num } from "../../lib/format";
import { orderText } from "./words";
import s from "./Spectrum.module.css";

const W = 640;
const H = 210;
const M = { l: 48, r: 14, t: 26, b: 30 };

const STEPS = [2, 5, 10, 20, 25, 50, 100];

export function Spectrum({ spectrum, lines }: { spectrum: ScanAnalysis["spectrum"]; lines: ScanAnalysis["lines"] }) {
  const { hz, px } = spectrum;
  if (hz.length < 2) return null;

  const xmax = hz[hz.length - 1];
  const ymax = Math.max(...px, 1e-6) * 1.08;
  const X = (v: number) => M.l + (v / xmax) * (W - M.l - M.r);
  const Y = (v: number) => H - M.b - (v / ymax) * (H - M.t - M.b);

  const path = hz.map((h, i) => `${i === 0 ? "M" : "L"}${X(h).toFixed(1)} ${Y(px[i]).toFixed(1)}`).join(" ");
  const step = STEPS.find((st) => xmax / st <= 8) ?? 100;
  const ticks = Array.from({ length: Math.floor(xmax / step) + 1 }, (_, i) => i * step);
  const strongest = Math.max(...lines.map((l) => l.amp), 1e-9);
  // Label a line only when it stands out, so the picture stays readable.
  const named = lines.filter((l) => l.order === 1 || l.order === 2 || l.amp >= 0.1 * strongest);

  return (
    <figure className={s.figure}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="spectrum-title" className={s.svg}>
        <title id="spectrum-title">
          {`How far the housing moves at each frequency up to ${num(xmax, 0)} Hz. ${named
            .map((l) => `${orderText(l.order)} at ${num(l.seen_hz, 1)} Hz`)
            .join(", ")}.`}
        </title>
        {ticks.map((t) => (
          <g key={t}>
            <line className={s.grid} x1={X(t)} x2={X(t)} y1={M.t} y2={H - M.b} />
            <text className={s.tick} x={X(t)} y={H - M.b + 16} textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        <line className={s.axis} x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} />
        <text className={s.tick} x={W - M.r} y={H - 4} textAnchor="end">
          Hz
        </text>
        {[0, 0.5, 1].map((f) => (
          <text key={f} className={s.tick} x={M.l - 6} y={Y((ymax / 1.08) * f) + 4} textAnchor="end">
            {num((ymax / 1.08) * f, 2)}
          </text>
        ))}
        <text className={s.tick} x={4} y={12}>
          px
        </text>
        {lines.map((l) => (
          <line key={l.order} className={l.clear ? s.line : s.crowded} x1={X(l.seen_hz)} x2={X(l.seen_hz)} y1={M.t - 6} y2={H - M.b} />
        ))}
        <path className={s.curve} d={path} />
        {named.map((l) => (
          <text key={l.order} className={s.order} x={X(l.seen_hz)} y={M.t - 10} textAnchor="middle">
            {orderText(l.order)}
          </text>
        ))}
      </svg>
      <figcaption className={s.caption}>
        Marked lines: the shaft speed times 0.5, 1, 1.5, 2 and so on. A dashed line is too slow to tell from drift, or sits on top of another line, so it can't be read by itself.
      </figcaption>
    </figure>
  );
}
