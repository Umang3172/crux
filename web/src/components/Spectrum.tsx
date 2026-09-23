/**
 * Real against simulated: the virtual experiment, drawn.
 *
 * The correlation number beside each hypothesis is the thing that moves belief,
 * and a number is easy to disbelieve. This is the same comparison with the
 * evidence on screen — the measured spectrum, and the spectrum the winning
 * hypothesis predicts. Two views, because the two fault families live in
 * different places: shaft orders in the raw spectrum, bearing impacts in the
 * envelope (see docs/DECISIONS.md, ADR-0003).
 *
 * uPlot draws to canvas, so the palette is repeated here as literals; keep it in
 * step with theme.css.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import type { AlignedData, Options } from "uplot";
import "uplot/dist/uPlot.min.css";
import { RunParams, Spectra, spectra } from "../api";

const REAL = "#57a9ff";
const SIM = "#35c89a";
const HEIGHT = 230;

function options(width: number, band: "raw" | "envelope"): Options {
  const axis = {
    stroke: "#64717d",
    grid: { stroke: "#19212a", width: 1 },
    ticks: { stroke: "#1f2831", width: 1 },
    font: "11px ui-monospace, monospace",
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
      { label: "simulated", stroke: SIM, width: 1.5, dash: [4, 3] },
    ],
  };
}

export function Spectrum({ params, hypothesis }: { params: RunParams; hypothesis: string | null }) {
  const [band, setBand] = useState<"raw" | "envelope">("raw");
  const [data, setData] = useState<Spectra | null>(null);
  const [missing, setMissing] = useState(false);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hypothesis) {
      setData(null);
      return;
    }
    let cancelled = false;
    spectra(params, hypothesis, band).then((result) => {
      if (cancelled) return;
      setData(result);
      setMissing(result === null);
    });
    return () => {
      cancelled = true;
    };
  }, [params, hypothesis, band]);

  const aligned = useMemo<AlignedData | null>(
    () =>
      data
        ? [
            Float64Array.from(data.freq_hz),
            Float64Array.from(data.real),
            Float64Array.from(data.simulated),
          ]
        : null,
    [data],
  );

  useEffect(() => {
    const el = host.current;
    if (!el || !aligned) return;
    const plot = new uPlot(options(el.clientWidth || 640, band), aligned, el);
    const observer = new ResizeObserver(() =>
      plot.setSize({ width: el.clientWidth || 640, height: HEIGHT }),
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      plot.destroy();
    };
  }, [aligned, band]);

  return (
    <section className="panel">
      <header>
        <h2>Measured against simulated</h2>
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

      {!hypothesis && <p className="empty">Run an investigation to see the comparison.</p>}

      {hypothesis && missing && (
        <p className="empty">
          This build of the API does not serve <code>POST /spectrum</code>. The deployed image and{" "}
          <code>make serve-app</code> do; <code>hypengine serve</code> does not.
        </p>
      )}

      {hypothesis && !missing && <div className="plot" ref={host} />}

      {data && (
        <div className="legend">
          <span>
            <i style={{ background: REAL }} /> measured capture
          </span>
          <span>
            <i style={{ background: SIM }} /> simulated · {data.hypothesis.replace("_", " ")}
          </span>
          <span>peak-hold, log-compressed, 0–{data.f_max_hz.toFixed(0)} Hz</span>
        </div>
      )}
    </section>
  );
}
