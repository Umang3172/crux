// The forecast, one signal at a time: what the model expected from "as of" on,
// its 80% range, and what really happened (a replay the model never saw).

import { useRef, useState } from "react";
import type { BenchView, ForecastView, Line, SpanMeta } from "../../api/series.types";
import type { Async } from "../../lib/hooks";
import { Seg } from "../../ui/kit";
import { MadeLine } from "./Made";
import { Trust } from "./Trust";
import { Slot, mean, num, peak, useFitHeight } from "./slot";
import { Legend, TimeChart } from "./TimeChart";

/** Current is read by its peak; a share or a temperature by its average. */
const BY_PEAK = new Set(["motor_current"]);

type Reach = "near" | "all";

/** History from `from` on: the forecast's own length before "as of" when zoomed in. */
const since = (l: Line, from: number): Line => {
  const i = l.t.findIndex((t) => t >= from);
  return i <= 0 ? l : { t: l.t.slice(i), v: l.v.slice(i) };
};

/** The stretch between the forecast and what really happened, where both exist at the same time. */
function missBand(p50: (number | null)[], ft: number[], actual: Line) {
  const at = new Map(actual.t.map((t, i) => [t, actual.v[i]]));
  const lo: (number | null)[] = [];
  const hi: (number | null)[] = [];
  ft.forEach((t, i) => {
    const a = at.get(t);
    const f = p50[i];
    const ok = a !== undefined && a !== null && f !== null;
    lo.push(ok ? Math.min(a, f) : null);
    hi.push(ok ? Math.max(a, f) : null);
  });
  return { t: ft, lo, hi };
}

function Chart({
  view,
  normal,
  signal,
  span,
  reach,
  bench,
}: {
  view: ForecastView;
  normal: ForecastView | undefined;
  signal: string;
  span: SpanMeta | undefined;
  reach: Reach;
  bench?: BenchView | null;
}) {
  // The benchmark scores the next day of the loaded share, so it speaks for that chart only.
  const scored = Boolean(bench) && view.span === "day" && signal === "loaded";
  const box = useRef<HTMLDivElement>(null);
  const height = useFitHeight(box, scored ? 182 : 150);
  const s = view.signals.find((x) => x.id === signal) ?? view.signals[0];
  if (!s) return null;
  const ahead = (s.forecast.t[s.forecast.t.length - 1] ?? view.as_of) - view.as_of;
  const history = reach === "near" ? since(s.history, view.as_of - ahead) : s.history;
  const miss = missBand(s.forecast.p50, s.forecast.t, s.actual);
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
            { id: "hist", label: "Recorded", t: history.t, v: history.v, tone: "text", width: 1.3 },
            { id: "act", label: "Really happened", t: s.actual.t, v: s.actual.v, tone: "muted", dashed: true, width: 1.3 },
            { id: "p50", label: "Forecast", t: s.forecast.t, v: s.forecast.p50, tone: "model", width: 2 },
          ]}
          bands={[
            { id: "band", label: "80% range", t: s.forecast.t, lo: s.forecast.lo, hi: s.forecast.hi, tone: "model" },
            { id: "miss", label: "Miss", ...miss, tone: "danger" },
          ]}
        />
      </div>
      <Legend
        items={[
          { label: "Recorded", tone: "text" },
          { label: "Forecast", tone: "model" },
          { label: "80% range", tone: "model", kind: "band" },
          { label: "What really happened", tone: "muted", kind: "dash" },
          { label: "Miss", tone: "danger", kind: "band" },
          { label: "Reported leak", tone: "danger", kind: "window" },
        ]}
      />
      <MadeLine made={view.made} what={`${view.made.model} in BigQuery${helpers}`} />
      {scored && <Trust bench={bench} what="forecast" />}
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
  bench,
}: {
  forecast: Async<ForecastView>;
  /** The normal week at the same span, for a leak week; absent for the normal week itself. */
  normal?: ForecastView;
  spans: SpanMeta[];
  span: string;
  signal: string;
  signals: { id: string; name: string }[];
  set: (k: string, v: string) => void;
  bench?: BenchView | null;
}) {
  const meta = spans.find((s) => s.id === span);
  const [reach, setReach] = useState<Reach>("near");
  return (
    <div className="tn-panel tn-plot">
      <div className="tn-bar">
        <Seg value={signal} onChange={(v) => set("signal", v)} options={signals.map((s) => ({ id: s.id, label: s.name }))} label="Signal" />
        <Seg value={span} onChange={(v) => set("span", v)} options={spans.map((s) => ({ id: s.id, label: s.label, title: `${s.model} · ${s.product}` }))} label="How far ahead" />
        <Seg
          value={reach}
          onChange={setReach}
          options={[
            { id: "near", label: "Around the forecast", title: "As much history as the forecast looks ahead" },
            { id: "all", label: "More history" },
          ]}
          label="History shown"
        />
      </div>
      <Slot a={forecast} rows={6}>
        {(v) => <Chart view={v} normal={normal} signal={signal} span={meta} reach={reach} bench={bench} />}
      </Slot>
    </div>
  );
}
