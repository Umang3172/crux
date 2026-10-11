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
