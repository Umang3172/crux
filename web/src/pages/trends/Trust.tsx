// How far to trust a screen: the model behind it, scored on every day of the
// record (GET /series/metro/bench), in one line that opens the Track record.
// Shown only for Google's run: the offline board has no TimesFM rows.

import { Link } from "react-router";
import type { BenchLeakRow, BenchView } from "../../api/series.types";
import { TAB_DETECTOR, TAB_FORECAST, daysScored, leads } from "../trust/benchBoards";

const pts = (x: number | null) => (x === null ? "–" : `${x.toFixed(1)} points`);

function forecastLine(b: BenchView): string | null {
  const g = b.forecast.groups.normal;
  const tab = g.rows.find((r) => r.id === TAB_FORECAST);
  const bar = g.rows.find((r) => r.id === "yesterday");
  if (!tab || !bar || tab.mae === null) return null;
  const inside = tab.inside === null ? "" : `; its 80% range held the truth ${Math.round(tab.inside * 100)}% of the time`;
  return `Scored on ${g.days} ordinary days (${daysScored(b)}): this forecast missed the next day by ${pts(tab.mae)} on average, repeating yesterday by ${pts(bar.mae)}${inside}.`;
}

function detectorLine(b: BenchView): string | null {
  const r = b.leaks.find((x) => x.id === TAB_DETECTOR);
  if (!r) return null;
  const rate = (x: BenchLeakRow) => (x.per_month === null ? "" : `, with ${x.per_month.toFixed(1)} false alarms a month`);
  const w = b.leaks.find((x) => x.id === "watcher");
  const watcher = w ? ` Crux's own watcher caught ${w.caught} of ${w.of}${rate(w)}.` : "";
  return `Run on every day from ${daysScored(b)}, this check caught ${r.caught} of ${r.of} leaks (${leads(r)})${rate(r)}.${watcher}`;
}

export function Trust({ bench, what }: { bench: BenchView | null | undefined; what: "forecast" | "detector" | "both" }) {
  if (!bench || bench.engine !== "bigquery") return null;
  const lines = [what !== "detector" && forecastLine(bench), what !== "forecast" && detectorLine(bench)].filter(Boolean) as string[];
  if (!lines.length) return null;
  return (
    <p className="tn-trust">
      {lines.join(" ")} <Link to="/proof">Track record</Link>
    </p>
  );
}
