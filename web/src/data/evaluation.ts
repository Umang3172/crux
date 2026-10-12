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

/** Other results that were measured, each with the data it came from. One falls short of its aim; it is here because it does. */
export const MEASURED = [
  {
    key: "off-list",
    figure: "24",
    of: "of 24",
    what: "A fault that is not on Crux's list: a damaged rolling element, fed to the synthetic rig on 24 different captures. The offline stand-in investigator wrote the missing suspect and the physics concluded on it every time.",
    source: "synthetic rig · offline stand-in",
  },
  {
    key: "watcher",
    figure: "14",
    of: "of 15",
    what: "XJTU-SY bearings where the watcher fired before the bearing failed. The one it missed failed in its cage.",
    source: "real recordings · XJTU-SY",
  },
  {
    key: "time-left",
    figure: "42%",
    of: "aim 80%",
    what: "How often the true time left fell inside the range Crux gives, against the 80% it aims for. The ranges are too narrow, so a forecast is a planning aid, not a promise. Each time one bearing was held out; 14 were scored.",
    source: "real recordings · XJTU-SY",
  },
] as const;

/** Real recordings, one row per dataset, whatever the state is. */
export const RECORDINGS = [
  {
    dataset: "XJTU-SY",
    kind: "15 bearings run to failure",
    run: "The watcher and the time-left forecast, above. An earlier diagnosis at the alarm was run before the engine changed.",
    result: "Diagnosis: to be re-run on the current engine. No number is shown.",
  },
  {
    dataset: "CWRU",
    kind: "Bearing recordings with known faults",
    run: "A loader and a benchmark exist. Nothing has been run on the real files.",
    result: "No result yet.",
  },
] as const;
