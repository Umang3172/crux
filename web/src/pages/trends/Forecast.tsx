// The forecast, one signal at a time: what the model expected from "as of" on,
// its 80% range, and what really happened (a replay the model never saw).

import { useRef } from "react";
import type { ForecastView, SpanMeta } from "../../api/series.types";
import type { Async } from "../../lib/hooks";
import { Seg } from "../../ui/kit";
import { MadeLine } from "./Made";
import { Slot, mean, num, peak, useFitHeight } from "./slot";
import { Legend, TimeChart } from "./TimeChart";

/** Current is read by its peak; a share or a temperature by its average. */
const BY_PEAK = new Set(["motor_current"]);

function Chart({ view, normal, signal, span }: { view: ForecastView; normal: ForecastView | undefined; signal: string; span: SpanMeta | undefined }) {
  const box = useRef<HTMLDivElement>(null);
  const height = useFitHeight(box, 150);
  const s = view.signals.find((x) => x.id === signal) ?? view.signals[0];
  if (!s) return null;
  const byPeak = BY_PEAK.has(s.id);
  const read = byPeak ? peak : mean;
  const expected = read(s.forecast.p50);
  const really = read(s.actual.v);
  // The same forecast also misses on a normal day; a leak day's miss reads true only beside it.
  const n = normal?.signals.find((x) => x.id === s.id);
  const over = span?.label.toLowerCase() ?? "ahead";
  const helpers = span?.model.startsWith("TimesFM") ? ", three signals at once, with reservoir pressure and the time of day as helpers" : "";
  return (
    <>
      <p className="tn-headline">
        {byPeak ? "Expected peak" : "Expected"} <b>{num(expected, s.unit)}</b> {byPeak ? "" : "on average "}over the {over}. Really{" "}
        <b className="tn-really">{num(really, s.unit)}</b>.
        {n && (
          <span className="tn-normal">
            {" "}
            Normal week: expected {num(read(n.forecast.p50), s.unit)}, really {num(read(n.actual.v), s.unit)}.
          </span>
        )}
      </p>
      <div ref={box}>
        <TimeChart
          unit={s.unit}
          label={`${s.name}: history, forecast and what really happened`}
          height={height}
          floor={s.id === "oil_temp" ? undefined : 0}
          asOf={view.as_of}
          windows={view.failures.map((f) => ({ start: f.start, end: f.end, label: "leak" }))}
          lines={[
            { id: "hist", label: "Recorded", t: s.history.t, v: s.history.v, tone: "text", width: 1.3 },
            { id: "act", label: "Really happened", t: s.actual.t, v: s.actual.v, tone: "muted", dashed: true, width: 1.3 },
            { id: "p50", label: "Forecast", t: s.forecast.t, v: s.forecast.p50, tone: "model", width: 2 },
          ]}
          bands={[{ id: "band", label: "80% range", t: s.forecast.t, lo: s.forecast.lo, hi: s.forecast.hi, tone: "model" }]}
        />
      </div>
      <Legend
        items={[
          { label: "Recorded", tone: "text" },
          { label: "Forecast", tone: "model" },
          { label: "80% range", tone: "model", kind: "band" },
          { label: "What really happened", tone: "muted", kind: "dash" },
          { label: "Reported leak", tone: "danger", kind: "window" },
        ]}
      />
      <MadeLine made={view.made} what={`${view.made.model} in BigQuery${helpers}`} />
    </>
  );
}

export function Forecast({
  forecast,
  normal,
  spans,
  span,
  signal,
  signals,
  set,
}: {
  forecast: Async<ForecastView>;
  /** The normal week at the same span, for a leak week; absent for the normal week itself. */
  normal?: ForecastView;
  spans: SpanMeta[];
  span: string;
  signal: string;
  signals: { id: string; name: string }[];
  set: (k: string, v: string) => void;
}) {
  const meta = spans.find((s) => s.id === span);
  return (
    <div className="tn-panel tn-plot">
      <div className="tn-bar">
        <Seg value={signal} onChange={(v) => set("signal", v)} options={signals.map((s) => ({ id: s.id, label: s.name }))} label="Signal" />
        <Seg value={span} onChange={(v) => set("span", v)} options={spans.map((s) => ({ id: s.id, label: s.label, title: `${s.model} · ${s.product}` }))} label="How far ahead" />
      </div>
      <Slot a={forecast} rows={6}>
        {(v) => <Chart view={v} normal={normal} signal={signal} span={meta} />}
      </Slot>
    </div>
  );
}
