// The compressor's benchmark (GET /series/metro/bench) as scoreboard boards and
// short lines for the Trends screens. Every number is the server's, formatted;
// the only thing chosen here is which row has the lowest miss.

import type { BenchForecastRow, BenchGroup, BenchLeakRow, BenchView } from "../../api/series.types";
import type { Board } from "../../data/evaluation";

const isGoogle = (v: BenchView) => v.engine === "bigquery";
const pts = (x: number | null) => (x === null ? null : `${x.toFixed(1)} pts`);
const ratio = (x: number | null) => (x === null ? null : x.toFixed(2));
const share = (x: number | null) => (x === null ? null : `${Math.round(x * 100)}%`);

const day = (iso: unknown) => {
  if (typeof iso !== "string") return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(d);
};

/** The days scored, as a phrase: "22 Feb 2020 to 30 Aug 2020". */
export const daysScored = (v: BenchView) => `${day(v.made.settings.first)} to ${day(v.made.settings.last)}`;

/** One leak's alarm against its reported start. */
export function lead(h: number | null): string {
  if (h === null) return "missed";
  if (h > 0) return `${h} h before`;
  return h === 0 ? "at the report" : `${-h} h after`;
}

export const leads = (r: BenchLeakRow) => r.leads_h.map(lead).join(" · ");

/** The forecast row with the lowest typical miss on ordinary days. */
export function best(rows: BenchForecastRow[]): BenchForecastRow | undefined {
  return rows.filter((r) => r.mae !== null).sort((a, b) => (a.mae as number) - (b.mae as number))[0];
}

/** Our miss for one method over every scored day, leak days included: the two groups pooled by step. */
function pooled(normal: BenchGroup, leak: BenchGroup, id: string): number | null {
  const n = normal.rows.find((r) => r.id === id);
  const l = leak.rows.find((r) => r.id === id);
  if (!n || !l || n.mae === null || l.mae === null) return null;
  return (n.mae * normal.steps + l.mae * leak.steps) / (normal.steps + leak.steps);
}

/** Short names for a sentence; the board's rows keep the full ones. */
const SHORT: Record<string, string> = {
  timesfm3_helpers: "TimesFM 3.0 with its helpers",
  timesfm3_alone: "TimesFM 3.0 alone",
  timesfm25_long: "TimesFM 2.5",
  yesterday: "Repeating yesterday",
  watcher: "Crux's watcher",
  timesfm: "TimesFM's check",
  band: "the 14-day band",
  plain: "the plain rule",
};
const short = (r: { id: string; method: string }) => SHORT[r.id] ?? r.method;

export const TAB_FORECAST = "timesfm3_helpers";
export const TAB_DETECTOR = "timesfm";

export function benchBoards(v: BenchView): Board[] {
  const normal = v.forecast.groups.normal;
  const leak = v.forecast.groups.leak;
  const top = best(normal.rows);
  const tab = normal.rows.find((r) => r.id === TAB_FORECAST);
  const source = `real recordings · MetroPT-3${isGoogle(v) ? "" : " · offline"}`;
  const run = "uv run python scripts/series.py bench --engine bigquery";
  const span = (rows: BenchForecastRow[]) => {
    const m = rows.map((r) => r.mae).filter((x): x is number => x !== null);
    return m.length ? `${Math.min(...m).toFixed(0)} to ${Math.max(...m).toFixed(0)} points` : null;
  };
  const forecastVerdict = [
    top && top.vs_bar !== null && `${short(top)} has the lowest typical miss, ${pts(top.mae)}: ${Math.round((1 - top.vs_bar) * 100)}% less error than repeating yesterday.`,
    top && top.inside !== null && `Its 80% range held the truth ${share(top.inside)} of the time.`,
    tab && tab.id !== top?.id && `The Trends tab runs ${short(tab)}, which missed by ${pts(tab.mae)}.`,
    leak.days > 0 && `On the ${leak.days} days whose next 24 hours held a reported leak, every method missed by ${span(leak.rows)}: none of them expects a leak.`,
  ]
    .filter(Boolean)
    .join(" ");
  const forecast: Board = {
    id: "compressor-forecast",
    job: "The compressor's next day",
    data: `The loaded share, 96 fifteen-minute steps from 08:00 on every day from ${daysScored(v)}: ${normal.days} ordinary days. A model never saw the day it forecast.`,
    source,
    columns: [
      { label: "Typical miss", tip: "Mean absolute error, in points of loaded share. Lower is better" },
      { label: "Against same time yesterday", tip: "Its summed error over that of repeating yesterday, on the same steps. Below 1 beats it" },
      { label: "Range held the truth", tip: "How often the real value fell inside the 80% range", aim: 0.8 },
    ],
    rows: normal.rows.map((r) => ({
      method: r.method,
      by: r.by,
      ships: r.id === TAB_FORECAST,
      cells: [pts(r.mae), ratio(r.vs_bar), share(r.inside)],
    })),
    verdict: forecastVerdict,
    run,
  };
  const check = v.forecast.check;
  if (check) {
    const pairs = Object.entries(check)
      .map(([id, c]) => {
        const row = normal.rows.find((r) => r.id === id);
        const name = row ? short(row) : id;
        const ours = pooled(normal, leak, id);
        return c.mean_absolute_error === null || ours === null ? null : `${name} ${c.mean_absolute_error.toFixed(1)} pts (ours ${ours.toFixed(1)})`;
      })
      .filter(Boolean);
    if (pairs.length)
      forecast.also = `Google's own AI.EVALUATE scored the same forecasts over all ${normal.days + leak.days} days, leak days included: ${pairs.join(", ")}. Ours draws them within 0 to 100% and leaves filled steps out.`;
  }
  const detectors: Board = {
    id: "compressor-leaks",
    job: "Noticing the compressor's air leaks",
    data: `Four detectors on the loaded share, every day from ${daysScored(v)}, scored by the watcher's rules: an alarm from a day before a reported leak to its end catches it; any other alarm after 1 Mar 2020 is a false alarm.`,
    source,
    columns: [
      { label: "Caught", tip: "Reported leaks with an alarm from 24 h before their start to their end" },
      { label: "Each leak", tip: "When the alarm came, against the reported start of leaks 1 to 4" },
      { label: "False alarms", tip: "Alarms that warned of nothing, per month" },
    ],
    rows: v.leaks.map((r) => ({
      method: r.method,
      by: r.by,
      cells: [`${r.caught} of ${r.of}`, leads(r), r.per_month === null ? null : `${r.per_month.toFixed(1)} a month`],
    })),
    verdict: leakVerdict(v.leaks),
    run,
  };
  return [forecast, detectors];
}

/** What the leak board shows, in numbers: who caught most with the fewest false alarms, and where TimesFM stands. */
function leakVerdict(rows: BenchLeakRow[]): string {
  const rate = (r: BenchLeakRow) => (r.per_month === null ? "–" : r.per_month.toFixed(1));
  const ranked = [...rows].sort((a, b) => b.caught - a.caught || (a.per_month ?? Infinity) - (b.per_month ?? Infinity));
  const first = ranked[0];
  const tied = ranked.filter((r) => r.caught === first.caught && r.per_month === first.per_month);
  const tfm = rows.find((r) => r.id === TAB_DETECTOR);
  const names = tied.map(short).join(" and ");
  const lead = `${names.charAt(0).toUpperCase()}${names.slice(1)} caught ${first.caught} of ${first.of} with ${rate(first)} false alarms a month.`;
  const google =
    tfm && !tied.includes(tfm)
      ? ` TimesFM's check caught ${tfm.caught} of ${tfm.of} with ${rate(tfm)} a month, so Trends shows its flags as readings to look at, not as alarms.`
      : "";
  const ahead = rows.every((r) => r.leads_h.every((h) => h === null || h < 24));
  const early = ahead ? " None warns a day or more ahead: in this record a leak shows around the time it is reported." : "";
  return lead + google + early;
}
