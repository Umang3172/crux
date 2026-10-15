// The Trends tab's contract with the server (`/series/*`, api/series.py there).
// Times are seconds since 1970 in the recording's own clock: draw them as UTC.

export type Engine = "bigquery" | "offline stand-in";

export type Made = {
  engine: Engine | string;
  model: string;
  product: string;
  sql: string;
  settings: Record<string, unknown>;
  computed_at: string;
  cost: { billed_bytes?: number; usd?: number; job?: string };
};

export type Line = { t: number[]; v: (number | null)[] };
export type Band = { t: number[]; p50: (number | null)[]; lo: (number | null)[]; hi: (number | null)[] };
export type Window = { start: number; end: number; label?: string };

export type SignalMeta = { id: string; name: string; unit: string };

export type ViewId = "forecast-hour" | "forecast-day" | "forecast-2w" | "anomalies" | "breakdown" | "changes" | "summary";

export type Preset = {
  id: string;
  label: string;
  as_of: number | null;
  note: string;
  engines: Partial<Record<ViewId, string | null>>;
  machine?: string;
};

export type SpanMeta = { id: "hour" | "day" | "2w"; label: string; cadence_min: number; horizon: number; model: string; product: string };

export type Source = {
  id: "metro" | "ims";
  name: string;
  kind: "compressor" | "bearing";
  dataset: string;
  available: boolean;
  signals: SignalMeta[];
  helpers: { past: SignalMeta[]; future: string[] };
  presets: Preset[];
  spans: SpanMeta[];
  views: ViewId[];
  failures: Window[];
  note: string | null;
};

export type Catalog = {
  sources: Source[];
  products: { job: string; product: string }[];
  ask: { live: boolean; examples: number };
};

export type ForecastSignal = SignalMeta & { history: Line; actual: Line; forecast: Band };

export type ForecastView = {
  source: string;
  preset: string;
  view: string;
  span: string;
  as_of: number;
  cadence_min: number;
  horizon: number;
  signals: ForecastSignal[];
  failures: Window[];
  made: Made;
};

export type AnomalySignal = SignalMeta & {
  t: number[];
  v: (number | null)[];
  lo: (number | null)[];
  hi: (number | null)[];
  flagged: number[];
  prob: (number | null)[] | null;
  /** The flagged readings that count: for the compressor, only while the motor ran. */
  counted?: number[];
  counted_before?: number | null;
  counted_after?: number | null;
};

/** A week's counted readings outside the band, before and after "as of". */
export type Tally = {
  preset: string;
  label: string;
  before: number;
  after: number | null;
  signals: Record<string, { before: number | null; after: number | null }>;
};

export type AnomaliesView = {
  source: string;
  preset: string;
  as_of: number | null;
  relative: boolean;
  /** Where a run's own clock starts: a relative axis reads hours from here. */
  origin?: number | null;
  cadence_min: number;
  window: Window;
  flagged: number;
  flagged_after_as_of: number | null;
  counted?: number | null;
  counted_after_as_of?: number | null;
  /** Flagged while the motor was off most of the step: a parked train, not counted. */
  not_counted_off?: number;
  off?: number[];
  /** The normal week's counts, sent with a leak week's. */
  normal?: Tally | null;
  signals: AnomalySignal[];
  failures: Window[];
  made: Made;
};

export type ChangeRow = {
  contributors: string[];
  label: string;
  test: number | null;
  control: number | null;
  ratio: number | null;
  attribution: number | null;
  support: number | null;
};

export type ChangesView = {
  source: string;
  preset: string;
  metric: string;
  test: Window;
  control: Window;
  overall: { test: number | null; control: number | null };
  rows: ChangeRow[];
  made: Made;
};

export type SummaryView = {
  source: string;
  preset: string;
  text: string;
  sentences: string[];
  facts: string[];
  writer: string;
  made: Made;
};

export type Answer = {
  question: string;
  answer: string;
  steps: string[];
  sql: string;
  columns: string[];
  rows: unknown[][];
  chart: Record<string, unknown> | null;
  followups: string[];
  made: Record<string, unknown> & { cost?: { billed_bytes?: number; usd?: number }; seconds?: number; computed_at?: string };
};

export type Examples = { live: boolean; answers: Answer[] };

/** One line of a live answer's stream: a phase of the agent's work opening or closing. */
export type AskStep =
  | { step: "tables" | "sql" | "query" | "answer" | "chart" | "cost" | "note"; state: "start" | "done" | "note"; detail: Record<string, unknown> }
  | { step: "result"; state: "done"; answer: Answer }
  | { step: "error"; state: "failed"; detail: { message?: string } };

/** Every day of the record scored (`GET /series/{source}/bench`; docs/SERIES.md "Benchmark"). */
export type BenchBy = "google" | "crux" | "baseline";

export type BenchForecastRow = {
  id: string;
  method: string;
  by: BenchBy;
  /** Mean absolute error, in points of loaded share. */
  mae: number | null;
  /** Summed error over the bar's ("same time yesterday") on the same steps: below 1 beats it. */
  vs_bar: number | null;
  /** Share of steps whose real value fell inside the 80% band. */
  inside: number | null;
};

export type BenchGroup = { days: number; steps: number; rows: BenchForecastRow[] };

export type BenchLeakRow = {
  id: string;
  method: string;
  by: BenchBy;
  caught: number;
  of: number;
  before: number;
  /** Per leak: hours from the alarm to the reported start; negative once it had begun; null if missed. */
  leads_h: (number | null)[];
  false: number;
  months: number;
  per_month: number | null;
};

export type BenchCheck = { origins: number; mean_absolute_error: number | null; mean_absolute_scaled_error: number | null; note: string };

export type BenchView = {
  source: string;
  view: "bench";
  engine: Engine | string;
  signal: string;
  forecast: {
    horizon_steps: number;
    cadence_min: number;
    groups: Record<"normal" | "leak", BenchGroup>;
    left_out: number;
    check: Record<string, BenchCheck> | null;
  };
  leaks: BenchLeakRow[];
  made: Made;
};
