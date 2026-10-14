// Trends: what the plant's sensors will do next, and what looks different now,
// computed by Google's own time-series tools on recorded history. Four screens,
// one at a time, each sized to fit without scrolling: the moment in plain
// words, the forecast, the readings outside the band, and a question asked of
// the data. Every number comes from the server's /series views; each screen
// names the Google product that made it and opens the SQL that ran.

import type { ReactNode } from "react";
import { ChartLine } from "lucide-react";
import { useSearchParams } from "react-router";
import { askExamples, seriesAnomalies, seriesCatalog, seriesChanges, seriesForecast, seriesSummary } from "../../api/series";
import type { AnomaliesView, ChangesView, ForecastView, Source, SummaryView } from "../../api/series.types";
import { useAsync } from "../../lib/hooks";
import { Callout, Card, Empty, ErrorState, PageHead, Seg, SkeletonRows, Tabs } from "../../ui/kit";
import { Ask } from "./Ask";
import { Forecast } from "./Forecast";
import { EngineBadge } from "./Made";
import { Overview } from "./Overview";
import { Unusual } from "./Unusual";
import "../pages.css";
import "./trends.css";

type Screen = "overview" | "forecast" | "unusual" | "ask";

/** The moment shown first: fixed with the others before any model ran (series/settings.py). */
const FIRST_PRESET: Record<string, string> = { metro: "leak2", ims: "ims/test2/bearing1" };
const MACHINE_LABEL: Record<Source["kind"], string> = { compressor: "Air compressor", bearing: "Bearing rig" };

/**
 * Machines the tab shows. The bearing rig's views are still served, but its
 * screen only counted readings outside a band, and on bearings Google's
 * forecaster does worse than Crux's own time-left model, so it is not shown.
 */
const SHOWN: Source["kind"][] = ["compressor"];

function Picker({ sources, source, preset, set }: { sources: Source[]; source: Source; preset: string; set: (k: string, v: string) => void }) {
  const note = source.presets.find((x) => x.id === preset)?.note;
  return (
    <div className="tn-picker">
      {sources.length > 1 && (
        <Seg value={source.id} onChange={(v) => set("source", v)} options={sources.map((s) => ({ id: s.id, label: MACHINE_LABEL[s.kind], title: s.dataset }))} label="Machine" />
      )}
      <Seg value={preset} onChange={(v) => set("at", v)} options={source.presets.map((x) => ({ id: x.id, label: x.label, title: x.note }))} label={source.kind === "bearing" ? "Bearing" : "Moment"} />
      {note && <span className="tn-picker-note">{note}</span>}
    </div>
  );
}

export default function TrendsPage() {
  const cat = useAsync((sig) => seriesCatalog(sig), []);
  const [params, setParams] = useSearchParams();
  const catalog = cat.data;
  const shown = catalog?.sources.filter((s) => SHOWN.includes(s.kind)) ?? [];
  const source = shown.find((s) => s.id === params.get("source")) ?? shown[0];
  const preset = source?.presets.find((p) => p.id === params.get("at"))?.id ?? (source ? (FIRST_PRESET[source.id] ?? source.presets[0]?.id) : "");
  const span = source?.spans.find((s) => s.id === params.get("span"))?.id ?? "day";
  const sid = source?.id ?? "";
  const metro = source?.kind === "compressor";
  const wanted = (params.get("view") as Screen) ?? "overview";
  const screen: Screen = wanted === "forecast" && !metro ? "overview" : wanted;
  const signal = source?.signals.find((s) => s.id === params.get("signal"))?.id ?? source?.signals[0]?.id ?? "";

  const set = (k: string, v: string) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.set(k, v);
        if (k === "source") {
          n.delete("at");
          n.delete("signal");
        }
        return n;
      },
      { replace: true },
    );

  const ready = Boolean(sid && preset);
  const skip = <T,>(): Promise<T> => new Promise(() => undefined);
  const forecast = useAsync((sig) => (ready && metro ? seriesForecast(sid, preset, span, sig) : skip<ForecastView>()), [sid, preset, span, metro]);
  const normalForecast = useAsync(
    (sig) => (ready && metro && preset !== "normal" ? seriesForecast(sid, "normal", span, sig) : skip<ForecastView>()),
    [sid, preset, span, metro],
  );
  const anomalies = useAsync((sig) => (ready ? seriesAnomalies(sid, preset, sig) : skip<AnomaliesView>()), [sid, preset]);
  const changes = useAsync((sig) => (ready && metro && preset !== "normal" ? seriesChanges(sid, preset, sig) : skip<ChangesView>()), [sid, preset, metro]);
  const summary = useAsync((sig) => (ready ? seriesSummary(sid, preset, sig) : skip<SummaryView>()), [sid, preset]);
  const examples = useAsync((sig) => askExamples(sig), []);

  const made = summary.data?.made ?? anomalies.data?.made;
  const head = (
    <PageHead title="Trends" sub="What the sensors will do next, and what looks off now." actions={made ? <EngineBadge made={made} /> : undefined} />
  );

  if (cat.error || (cat.loading && !catalog) || !catalog || !source) {
    return (
      <div className="page tn-page">
        {head}
        <Card>
          {cat.error ? (
            <ErrorState error={cat.error} onRetry={cat.reload} />
          ) : cat.loading ? (
            <SkeletonRows rows={6} />
          ) : (
            <Empty icon={<ChartLine size={18} />} title="This server has no Trends">
              The server answered without the /series routes, so there is nothing to show here.
            </Empty>
          )}
        </Card>
      </div>
    );
  }

  /** A label with a shorter form for a phone, so all four tabs show at once. */
  const named = (long: string, short: string) => (
    <>
      <span className="tn-long">{long}</span>
      <span className="tn-short">{short}</span>
    </>
  );
  const screens: { id: Screen; label: ReactNode }[] = [
    { id: "overview", label: "Overview" },
    ...(metro ? [{ id: "forecast" as const, label: "Forecast" }] : []),
    { id: "unusual", label: named("Unusual readings", "Unusual") },
    ...(examples.data && (examples.data.live || examples.data.answers.length) ? [{ id: "ask" as const, label: named("Ask the data", "Ask") }] : []),
  ];

  return (
    <div className="page tn-page">
      {head}
      <Tabs value={screen} onChange={(v) => set("view", v)} tabs={screens} label="Trends screens" />
      {screen !== "ask" && <Picker sources={shown} source={source} preset={preset} set={set} />}
      {screen !== "ask" && !source.available && <Callout tone="warn">This server holds no recorded history for this machine, so only saved Google results can show.</Callout>}

      <div className="tn-screen" key={screen}>
        {screen === "overview" && <Overview source={source} preset={source.presets.find((p) => p.id === preset)} summary={summary} changes={changes} />}
        {screen === "forecast" && (
          <Forecast forecast={forecast} normal={preset !== "normal" ? (normalForecast.data ?? undefined) : undefined} spans={source.spans} span={span} signal={signal} signals={source.signals} set={set} />
        )}
        {screen === "unusual" && <Unusual anomalies={anomalies} signal={signal} set={set} />}
        {screen === "ask" && examples.data && <Ask examples={examples.data} />}
      </div>
    </div>
  );
}
