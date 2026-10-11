// Signal views drawn from the engine's numbers: the waveform preview, the
// spectra of real and simulated captures, and the scale the deciding reading
// lands on.

import { motion } from "motion/react";
import { useMemo } from "react";
import type { Spectrum } from "../../api/types";
import { useReducedMotion } from "../../lib/hooks";
import { signed } from "../../lib/format";
import s from "./Signals.module.css";

export function Waveform({ values, label, height = 72 }: { values: number[]; label: string; height?: number }) {
  const d = useMemo(() => {
    const max = Math.max(1e-9, ...values.map((v) => Math.abs(v)));
    return values.map((v, i) => `${i === 0 ? "M" : "L"}${((i / (values.length - 1)) * 1000).toFixed(1)} ${(50 - (v / max) * 46).toFixed(1)}`).join("");
  }, [values]);
  return (
    <svg className={s.wave} viewBox="0 0 1000 100" preserveAspectRatio="none" style={{ height }} role="img" aria-label={label}>
      <line x1="0" y1="50" x2="1000" y2="50" className={s.axis} />
      <path d={d} className={s.trace} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export type Marker = { hz: number; label: string };

/** Real capture against one or two simulations of it. */
export function SpectrumPlot({
  real,
  sims,
  markers = [],
  label,
}: {
  real: Spectrum;
  sims: { name: string; tone: "ok" | "attention" | "ink"; spectrum: Spectrum }[];
  markers?: Marker[];
  label: string;
}) {
  const fmax = real.f_max_hz;
  const ymax = Math.max(1e-9, ...real.real, ...sims.flatMap((x) => x.spectrum.simulated));
  const path = (xs: number[], ys: number[]) =>
    xs.map((f, i) => `${i === 0 ? "M" : "L"}${((f / fmax) * 1000).toFixed(1)} ${(190 - (ys[i] / ymax) * 170).toFixed(1)}`).join("");
  return (
    <figure className={s.spectrum}>
      <svg viewBox="0 0 1000 220" role="img" aria-label={label}>
        {markers.map((m) => (
          <g key={m.label}>
            <line x1={(m.hz / fmax) * 1000} x2={(m.hz / fmax) * 1000} y1="10" y2="190" className={s.marker} />
            <text x={(m.hz / fmax) * 1000 + 4} y="22" className={s.markerText}>
              {m.label}
            </text>
          </g>
        ))}
        <line x1="0" y1="190" x2="1000" y2="190" className={s.axis} />
        {sims.map((x) => (
          <path key={x.name} d={path(x.spectrum.freq_hz, x.spectrum.simulated)} className={`${s.sim} ${s[x.tone]}`} vectorEffect="non-scaling-stroke" />
        ))}
        <path d={path(real.freq_hz, real.real)} className={s.real} vectorEffect="non-scaling-stroke" />
        {[0, 0.25, 0.5, 0.75, 1].map((k) => (
          <text key={k} x={k * 1000} y="210" className={s.tick} textAnchor={k === 0 ? "start" : k === 1 ? "end" : "middle"}>
            {Math.round(k * fmax)} Hz
          </text>
        ))}
      </svg>
      <figcaption className={s.legend}>
        <span className={s.keyReal}>This reading</span>
        {sims.map((x) => (
          <span key={x.name} className={`${s.keySim} ${s[x.tone]}`}>
            Simulated: {x.name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/**
 * Where each suspect says the check will read, with its spread, and where the
 * reading landed. The reading falls onto the scale when it arrives.
 */
export function DecidingScale({
  predictions,
  sigma,
  value,
  label,
}: {
  predictions: { name: string; value: number; tone: "ok" | "attention" }[];
  sigma: number;
  value?: number | null;
  label: string;
}) {
  const reduce = useReducedMotion();
  const xs = predictions.flatMap((p) => [p.value - 2 * sigma, p.value + 2 * sigma]).concat(value ?? []);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const pad = (hi - lo) * 0.06;
  const x = (v: number) => ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 1000;
  return (
    <figure className={s.scale}>
      <svg viewBox="0 -10 1000 175" role="img" aria-label={label}>
        <line x1="0" y1="96" x2="1000" y2="96" className={s.scaleAxis} />
        {predictions.map((p, i) => (
          <g key={p.name}>
            <rect x={x(p.value - sigma)} width={x(p.value + sigma) - x(p.value - sigma)} y={i === 0 ? 70 : 100} height="22" className={`${s.band} ${s[p.tone]}`} />
            <line x1={x(p.value)} x2={x(p.value)} y1={i === 0 ? 62 : 100} y2={i === 0 ? 96 : 130} className={s.predTick} />
            <text x={x(p.value)} y={i === 0 ? 52 : 156} textAnchor="middle" className={s.predText}>
              {p.name} ≈ {signed(p.value)}
            </text>
          </g>
        ))}
        {value !== undefined && value !== null && (
          <motion.g
            initial={reduce ? false : { y: -60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 20 }}
          >
            <line x1={x(value)} x2={x(value)} y1="24" y2="96" className={s.reading} />
            <circle cx={x(value)} cy="96" r="7" className={s.readingDot} />
            <text x={x(value)} y="10" textAnchor="middle" className={s.readingText}>
              The reading: {signed(value)}
            </text>
          </motion.g>
        )}
      </svg>
      <figcaption className={s.legend}>The shaded spans show how far each suspect's prediction can spread (one standard deviation).</figcaption>
    </figure>
  );
}
