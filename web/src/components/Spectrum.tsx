/**
 * Real against simulated: the virtual experiment, drawn.
 *
 * Beliefs move by a likelihood built from many simulations (docs/DECISIONS.md,
 * ADR-0008), and a number is easy to disbelieve. This is the comparison with the
 * evidence on screen — the measured spectrum, and one simulation of the winning
 * hypothesis, with the correlation between them beside it as a picture of the
 * fit. Two views, because the two fault families live in different places:
 * shaft orders in the raw spectrum, bearing impacts in the envelope.
 *
 * uPlot draws to canvas, so the palette is repeated here as literals; keep it in
 * step with theme.css.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import type { AlignedData, Options } from "uplot";
import "uplot/dist/uPlot.min.css";
import { RunParams, Spectra, spectra } from "../api";

const REAL = "#14222c";
/** One colour per simulated suspect: the leader, then the rival it cannot yet beat. */
const SIMS = ["#1597a5", "#d7383b"];
const HEIGHT = 230;

function options(width: number, band: "raw" | "envelope", suspects: string[]): Options {
  const axis = {
    stroke: "#7f909c",
    grid: { stroke: "#e1e7eb", width: 1 },
    ticks: { stroke: "#d3dce1", width: 1 },
    font: "11px Archivo, system-ui, sans-serif",
  };
  return {
    width,
    height: HEIGHT,
    padding: [10, 8, 0, 0],
    legend: { show: false },
    cursor: { drag: { x: true, y: false } },
    scales: { x: { time: false } },
    axes: [
      { ...axis, label: band === "raw" ? "Hz" : "Hz (envelope)", labelSize: 22 },
      { ...axis, size: 44 },
    ],
    series: [
      {},
      { label: "measured", stroke: REAL, width: 1.5 },
      ...suspects.map((s, i) => ({
        label: s,
        stroke: SIMS[i % SIMS.length],
        width: 1.5,
        dash: i === 0 ? [4, 3] : [1, 3],
      })),
    ],
  };
}

/**
 * `suspects` is one hypothesis (the leader) or two (the pair the engine cannot
 * separate yet). With two, this is the tie chart: both simulations over the same
 * capture, and the raw/envelope switch shows where one of them stops fitting.
 */
export function Spectrum({ params, suspects }: { params: RunParams; suspects: string[] }) {
  const [band, setBand] = useState<"raw" | "envelope">("raw");
  const [data, setData] = useState<Spectra[] | null>(null);
  const [missing, setMissing] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const key = suspects.join("|");
  const tie = suspects.length > 1;

  useEffect(() => {
    if (suspects.length === 0) {
      setData(null);
      return;
    }
    let cancelled = false;
    Promise.all(suspects.map((s) => spectra(params, s, band))).then((results) => {
      if (cancelled) return;
      const complete = results.every((r) => r !== null);
      setData(complete ? (results as Spectra[]) : null);
      setMissing(!complete);
    });
    return () => {
      cancelled = true;
    };
    // `key` stands in for `suspects`, whose identity changes on every render.
  }, [params, key, band]);

  const aligned = useMemo<AlignedData | null>(
    () =>
      data && data.length > 0
        ? [
            Float64Array.from(data[0].freq_hz),
            Float64Array.from(data[0].real),
            ...data.map((d) => Float64Array.from(d.simulated)),
          ]
        : null,
    [data],
  );

  useEffect(() => {
    const el = host.current;
    if (!el || !aligned || !data) return;
    const names = data.map((d) => d.hypothesis.replace("_", " "));
    const plot = new uPlot(options(el.clientWidth || 640, band, names), aligned, el);
    const observer = new ResizeObserver(() =>
      plot.setSize({ width: el.clientWidth || 640, height: HEIGHT }),
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      plot.destroy();
    };
  }, [aligned, band, data]);

  return (
    <section className="panel">
      <header>
        <h2>{tie ? "Can't tell these apart" : "Measured against simulated"}</h2>
        <span className="note">
          <span className="segmented" style={{ padding: 2 }}>
            {(["raw", "envelope"] as const).map((b) => (
              <button key={b} aria-pressed={band === b} onClick={() => setBand(b)}>
                {b}
              </button>
            ))}
          </span>
        </span>
      </header>

      {suspects.length === 0 && (
        <p className="empty">Run an investigation to see the comparison.</p>
      )}

      {tie && (
        <p className="empty" style={{ textAlign: "left", padding: "0 0 8px" }}>
          Both suspects reproduce the capture this well. Switch between raw and envelope to see
          where one of them stops fitting, then the measurement below settles it.
        </p>
      )}

      {suspects.length > 0 && missing && (
        <p className="empty">
          This build of the API does not serve <code>POST /spectrum</code>. The deployed image and{" "}
          <code>make serve-app</code> do; <code>hypengine serve</code> does not.
        </p>
      )}

      {suspects.length > 0 && !missing && <div className="plot" ref={host} />}

      {data && data.length > 0 && (
        <div className="legend">
          <span>
            <i style={{ background: REAL }} /> measured capture
          </span>
          {data.map((d, i) => (
            <span key={d.hypothesis}>
              <i style={{ background: SIMS[i % SIMS.length] }} /> simulated ·{" "}
              {d.hypothesis.replace("_", " ")}
            </span>
          ))}
          <span>peak-hold, log-compressed, 0–{data[0].f_max_hz.toFixed(0)} Hz</span>
        </div>
      )}
    </section>
  );
}
