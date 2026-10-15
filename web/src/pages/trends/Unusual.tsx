// Readings outside the expected band, one signal at a time: each day held to
// what TimesFM expected from the history before it, as a daily job would run.

import { useRef } from "react";
import type { AnomaliesView, BenchView } from "../../api/series.types";
import type { Async } from "../../lib/hooks";
import { Seg } from "../../ui/kit";
import { MadeLine } from "./Made";
import { Trust } from "./Trust";
import { Slot, useFitHeight } from "./slot";
import { Legend, TimeChart } from "./TimeChart";

/** "(normal week 12)" beside a count, when the server sent the normal week's. */
function Normal({ n }: { n: number | null | undefined }) {
  return n === undefined || n === null ? null : <span className="tn-normal"> (normal week {n})</span>;
}

function Chart({ view, signal, set, bench }: { view: AnomaliesView; signal: string; set: (k: string, v: string) => void; bench?: BenchView | null }) {
  const s = view.signals.find((x) => x.id === signal) ?? view.signals[0];
  // The benchmark scores the check on the loaded share, so it speaks for that chart only.
  const scored = Boolean(bench) && s?.id === "loaded";
  const box = useRef<HTMLDivElement>(null);
  const height = useFitHeight(box, scored ? 182 : 150);
  if (!s) return null;
  const counted = s.counted ?? s.flagged;
  const kept = new Set(counted);
  const parked = s.flagged.filter((i) => !kept.has(i) && s.v[i] !== null);
  const days = view.as_of === null ? 0 : Math.round((view.as_of - view.window.start) / 86400);
  const normal = view.normal?.signals[s.id];
  const dot = (tone: string) => (i: number) => ({ t: s.t[i], v: s.v[i] as number, tone });
  return (
    <>
      <div className="tn-bar">
        <Seg
          value={s.id}
          onChange={(v) => set("signal", v)}
          options={view.signals.map((x) => ({ id: x.id, label: `${x.name} · ${(x.counted ?? x.flagged).length}` }))}
          label="Signal, with how many readings fell outside while the motor ran"
        />
      </div>
      {view.relative || s.counted_before === undefined ? (
        <p className="tn-headline tn-plain">
          <b>{s.flagged.length}</b> {s.name.toLowerCase()} readings fell outside the expected band {view.relative ? "in the last week of the run" : "in the week"}.
        </p>
      ) : (
        <p className="tn-headline tn-plain">
          While the motor ran, <b>{s.counted_before}</b> {s.name.toLowerCase()} readings fell outside the expected band in the {days} days before “as of”
          <Normal n={normal?.before} /> and <b>{s.counted_after}</b> in the day after
          <Normal n={normal?.after} />.{" "}
          {parked.length > 0 && <span className="tn-normal">{parked.length} more fell while the motor was off and are not counted.</span>}
        </p>
      )}
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
          dots={[...parked.map(dot("muted")), ...counted.filter((i) => s.v[i] !== null).map(dot("danger"))]}
        />
      </div>
      <Legend
        items={[
          { label: "Reading", tone: "text" },
          { label: "Expected band", tone: "accent", kind: "band" },
          { label: "Outside it", tone: "danger", kind: "dot" },
          ...(parked.length ? [{ label: "Outside it, motor off", tone: "muted", kind: "dot" as const }] : []),
          ...(view.relative ? [] : [{ label: "Reported leak", tone: "danger", kind: "window" as const }]),
        ]}
      />
      <MadeLine made={view.made} what={`${view.made.model} in BigQuery, each day held to what the days before it predicted`} />
      {scored && <Trust bench={bench} what="detector" />}
    </>
  );
}

export function Unusual({
  anomalies,
  signal,
  set,
  bench,
}: {
  anomalies: Async<AnomaliesView>;
  signal: string;
  set: (k: string, v: string) => void;
  bench?: BenchView | null;
}) {
  return (
    <div className="tn-panel tn-plot">
      <Slot a={anomalies} rows={6}>
        {(v) => <Chart view={v} signal={signal} set={set} bench={bench} />}
      </Slot>
    </div>
  );
}
