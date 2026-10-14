// Readings outside the expected band, one signal at a time: each day held to
// what TimesFM expected from the history before it, as a daily job would run.

import { useRef } from "react";
import type { AnomaliesView } from "../../api/series.types";
import type { Async } from "../../lib/hooks";
import { Seg } from "../../ui/kit";
import { MadeLine } from "./Made";
import { Slot, useFitHeight } from "./slot";
import { Legend, TimeChart } from "./TimeChart";

function Chart({ view, signal, set }: { view: AnomaliesView; signal: string; set: (k: string, v: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const height = useFitHeight(box, 150);
  const s = view.signals.find((x) => x.id === signal) ?? view.signals[0];
  if (!s) return null;
  const after = view.as_of === null ? null : s.flagged.filter((i) => s.t[i] >= (view.as_of as number)).length;
  return (
    <>
      <div className="tn-bar">
        <Seg
          value={s.id}
          onChange={(v) => set("signal", v)}
          options={view.signals.map((x) => ({ id: x.id, label: `${x.name} · ${x.flagged.length}` }))}
          label="Signal, with how many readings fell outside"
        />
      </div>
      <p className="tn-headline tn-plain">
        <b>{s.flagged.length}</b> {s.name.toLowerCase()} readings fell outside the expected band{" "}
        {view.relative ? "in the last week of the run" : "in the week"}
        {after !== null && !view.relative ? (
          <>
            , <b>{after}</b> of them in the day after “as of”
          </>
        ) : null}
        .
      </p>
      <div ref={box}>
        <TimeChart
          unit={s.unit}
          label={`${s.name}: readings and the expected band`}
          height={height}
          relative={view.relative}
          origin={view.origin}
          asOf={view.as_of}
          windows={view.failures.map((f) => ({ start: f.start, end: f.end, label: "leak" }))}
          lines={[{ id: "v", label: "Reading", t: s.t, v: s.v, tone: "text", width: 1.1 }]}
          bands={[{ id: "band", label: "Expected", t: s.t, lo: s.lo, hi: s.hi, tone: "accent" }]}
          dots={s.flagged.filter((i) => s.v[i] !== null).map((i) => ({ t: s.t[i], v: s.v[i] as number, tone: "danger" }))}
        />
      </div>
      <Legend
        items={[
          { label: "Reading", tone: "text" },
          { label: "Expected band", tone: "accent", kind: "band" },
          { label: "Outside it", tone: "danger", kind: "dot" },
          ...(view.relative ? [] : [{ label: "Reported leak", tone: "danger", kind: "window" as const }]),
        ]}
      />
      <MadeLine made={view.made} what={`${view.made.model} in BigQuery, each day held to what the days before it predicted`} />
    </>
  );
}

export function Unusual({ anomalies, signal, set }: { anomalies: Async<AnomaliesView>; signal: string; set: (k: string, v: string) => void }) {
  return (
    <div className="tn-panel tn-plot">
      <Slot a={anomalies} rows={6}>
        {(v) => <Chart view={v} signal={signal} set={set} />}
      </Slot>
    </div>
  );
}
