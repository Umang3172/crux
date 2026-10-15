// Every figure on the Proof page, in one place, with where it came from. None
// is computed in the browser or rounded for effect: they are what the
// project's own runs printed, and the page names the run beside them.
//
// Synthetic set: `uv run hypengine evaluate` runs 180 hard cases (three faults
// at three strengths under four noise levels, five seeds each), answered by a
// new capture of the same machine whenever a check is asked for. The command
// prints the totals and the table by fault. The split by whether a check was
// asked, and the case-by-case comparison with the best match, are counted
// from the same 180 runs.

export const TOTAL = 180;
export const PER_FAULT = 60;

export const CRUX = {
  /** Named the right cause without asking anyone. */
  alone: 88,
  /** Asked for a check, then named the right cause. */
  afterCheck: 42,
  /** Said it couldn't tell; every one had asked for checks first. */
  cantTell: 50,
  wrong: 0,
} as const;

export const CRUX_RIGHT = CRUX.alone + CRUX.afterCheck;
export const ASKED = CRUX.afterCheck + CRUX.cantTell;

/** Naming the best spectral match: the simplest thing that always answers. */
export const BEST = { right: 140, wrong: 40 } as const;

/** The 40 cases where the best match named the wrong fault, as Crux handled them. */
export const WHERE_BEST_WRONG = { cantTell: 26, right: 14 } as const;

export const BY_FAULT = [
  { fault: "outer_race", right: 42, cantTell: 18, wrong: 0, asked: 29, bestRight: 52 },
  { fault: "inner_race", right: 40, cantTell: 20, wrong: 0, asked: 39, bestRight: 49 },
  { fault: "imbalance", right: 48, cantTell: 12, wrong: 0, asked: 24, bestRight: 39 },
] as const;

export const REPO = "https://github.com/Umang3172/crux";
export const COMMAND = "uv run hypengine evaluate";

/**
 * The scoreboard: for each job Crux does, the method it runs beside the ones
 * it was tested against, Google's included, on the same data and split. A
 * cell is the text the run printed; `null` is a dash. The rows come from:
 *
 * - XJTU-SY and IMS time left: docs/FORECAST.md, "Results (6 Oct 2026)", "Calibrated
 *   ranges" and "Google's TimesFM" (runs of 6 and 13 Oct 2026).
 * - An alarm before a bearing fails: docs/FORECAST.md, "Watcher, XJTU-SY".
 * - The compressor's boards come from the server (GET /series/metro/bench).
 * - Naming the fault: the synthetic set above.
 */
export type BenchBy = "crux" | "google" | "baseline";

export type BenchRow = {
  method: string;
  by: BenchBy;
  /** The method Crux runs for this job. */
  ships?: boolean;
  /** Set when the method was added after a test result was seen: shown dimmed, with this note. */
  after?: string;
  cells: (string | null)[];
};

export type BenchColumn = {
  label: string;
  tip: string;
  /** Draw the cell's percentage as a bar against this aim. */
  aim?: number;
};

export type Board = {
  id: string;
  job: string;
  data: string;
  source: string;
  columns: BenchColumn[];
  rows: BenchRow[];
  /** One line: why the method that ships won. */
  verdict: string;
  /** A further result for the same job, in a line. */
  also?: string;
  /** The command that prints the table again. */
  run: string;
};

const TIME_LEFT: BenchColumn[] = [
  { label: "Typical miss", tip: "Median error of the most likely time left, as a share of the life that was left after the alarm. Lower is better" },
  { label: "Range held the truth", tip: "How often the real failure fell inside the p10 to p90 range. It should be 80%", aim: 0.8 },
  { label: "Early end too late", tip: "How often even the early end of the range came after the real failure: the dangerous mistake. Lower is better" },
];

const RATCHET = "Added after TimesFM had been seen forecasting one test bearing's jump falling back, so it is not counted.";

export const BOARDS: Board[] = [
  {
    id: "time-left",
    job: "Time left on a failing bearing",
    data: "XJTU-SY: 15 bearings run until they failed. Each is held out in turn and forecast by a model that never saw it; 14 scored.",
    source: "real recordings · XJTU-SY",
    columns: TIME_LEFT,
    rows: [
      { method: "Crux's trained model, calibrated", by: "crux", ships: true, cells: ["0.60", "80%", "9%"] },
      { method: "Crux's trained model, before calibration", by: "crux", cells: ["0.60", "42%", "33%"] },
      { method: "Straight trend, calibrated", by: "baseline", cells: ["0.69", "79%", "11%"] },
      { method: "Straight trend", by: "baseline", cells: ["0.69", "27%", "49%"] },
      { method: "Average life", by: "baseline", cells: ["2.00", "52%", "40%"] },
      { method: "Google TimesFM 3.0", by: "google", cells: ["4.56", "43%", "45%"] },
      { method: "Google TimesFM 2.5", by: "google", cells: ["6.16", "24%", "67%"] },
      { method: "Google TimesFM 3.0, running maximum", by: "google", after: RATCHET, cells: ["2.43", "58%", "29%"] },
    ],
    verdict:
      "TimesFM expects a series to keep the shape it has had, so it forecasts a growing fault levelling off and the danger line is reached too late or never. Crux's model learned from bearings that did fail.",
    run: "uv run python scripts/forecast.py calibrate",
  },
  {
    id: "other-lab",
    job: "The same model at another lab",
    data: "Trained on XJTU-SY only and tested on 4 IMS bearings it never saw, with no refitting. Four bearings: a hint, not proof.",
    source: "real recordings · IMS",
    columns: TIME_LEFT,
    rows: [
      { method: "Crux's trained model, calibrated", by: "crux", ships: true, cells: ["0.45", "65%", "8%"] },
      { method: "Crux's trained model, before calibration", by: "crux", cells: ["0.45", "32%", "17%"] },
      { method: "Straight trend, calibrated", by: "baseline", cells: ["1.76", "76%", "22%"] },
      { method: "Average life", by: "baseline", cells: ["0.45", "8%", "9%"] },
      { method: "Google TimesFM 3.0", by: "google", cells: ["28.74", "5%", "95%"] },
      { method: "Google TimesFM 2.5", by: "google", cells: ["28.74", "7%", "93%"] },
      { method: "Google TimesFM 3.0, running maximum", by: "google", after: RATCHET, cells: ["17.97", "19%", "81%"] },
    ],
    verdict: "Its ranges hold 65% here, short of 80%: the correction was measured at XJTU-SY only. It still makes the dangerous mistake least often.",
    run: "uv run python scripts/forecast.py calibrate",
  },
  {
    id: "notice",
    job: "An alarm before a bearing fails",
    data: "Crux's watcher compares each bearing with its own normal. XJTU-SY: 15 bearings run until they failed, rules frozen on 3 Oct 2026 before the test.",
    source: "real recordings · XJTU-SY",
    columns: [
      { label: "Caught", tip: "Bearings the watcher raised an alarm for before they failed" },
      { label: "Warning", tip: "Running hours from the alarm to the failure" },
    ],
    rows: [{ method: "Crux's watcher", by: "crux", ships: true, cells: ["14 of 15", "0.1 to 6.4 h"] }],
    verdict: "The one it missed failed in its cage. These lives were accelerated, 0.7 to 42 hours, so the warning is hours, not weeks.",
    run: "uv run python scripts/forecast.py evaluate",
  },
  {
    id: "diagnosis",
    job: "Naming the fault",
    data: `${TOTAL} hard synthetic cases: three faults at three strengths under four noise levels. Not yet measured on real recordings with the current engine.`,
    source: "synthetic cases",
    columns: [
      { label: "Right", tip: "Named the true fault" },
      { label: "Wrong", tip: "Named another fault" },
      { label: "Declined", tip: "Said it could not tell, after asking for a measurement" },
    ],
    rows: [
      { method: "Crux: simulate, then ask for the deciding measurement", by: "crux", ships: true, cells: [String(CRUX_RIGHT), String(CRUX.wrong), String(CRUX.cantTell)] },
      { method: "Best spectral match, always answers", by: "baseline", cells: [String(BEST.right), String(BEST.wrong), "0"] },
    ],
    verdict: `Crux gives up ${BEST.right - CRUX_RIGHT} right answers to avoid ${BEST.wrong - CRUX.wrong} wrong ones. A wrong cause sends a crew to the wrong part.`,
    also: "A fault not on its list (a damaged rolling element, 24 synthetic captures): the offline stand-in investigator wrote the missing suspect and the physics concluded on it all 24 times.",
    run: COMMAND,
  },
];

/** Real recordings, one row per dataset, whatever the state is. */
export const RECORDINGS = [
  {
    dataset: "XJTU-SY",
    kind: "15 bearings run to failure",
    run: "Alarm and time left: on the Benchmarks tab. A diagnosis at the alarm ran before the engine changed.",
    result: "Diagnosis to be re-run. No number shown.",
  },
  {
    dataset: "CWRU",
    kind: "Bearing recordings with known faults",
    run: "A loader and a benchmark exist. Nothing has run on the real files.",
    result: "No result yet.",
  },
] as const;

/** The watcher on the compressor with the first month as its fixed normal (docs/FORECAST.md, "MetroPT-3"). */
export const FIXED_NORMAL =
  "With the first month as a fixed normal instead, the watcher caught 3 of 4 and raised 7.1 false alarms a month: a fixed normal mistakes a lasting change in use for a fault.";
