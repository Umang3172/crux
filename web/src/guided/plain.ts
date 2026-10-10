/**
 * Plain words for the guided view.
 *
 * Everything a non-engineer reads on the guided screen comes from here or from a
 * number the engine returned. The wording explains; it never adds a claim the
 * engine did not make. Fault ids match `FaultKind` in `models.py`.
 */

import { Hypothesis, Investigation } from "../api";

/** Which part of the pump set a fault lives in, so the scene can point at it. */
export type Part = "rotor" | "coupling" | "base" | "bearing" | "none";

export type FaultText = {
  name: string;
  part: Part;
  partName: string;
  story: string;
  fix: string;
};

export const FAULT_TEXT: Record<string, FaultText> = {
  healthy: {
    name: "Nothing wrong",
    part: "none",
    partName: "the whole pump set",
    story: "The pump is running the way a healthy one does.",
    fix: "No action. Keep this reading as the baseline and check again on the normal round.",
  },
  imbalance: {
    name: "Rotor out of balance",
    part: "rotor",
    partName: "the pump impeller",
    story:
      "A heavy spot on the spinning impeller makes it wobble once every turn, like a washing machine with the clothes bunched on one side.",
    fix: "Balance the rotor. Check first for debris stuck to the impeller.",
  },
  misalignment: {
    name: "Shafts out of line",
    part: "coupling",
    partName: "the coupling between motor and pump",
    story:
      "The motor and pump shafts don't line up, so the coupling between them flexes twice every turn.",
    fix: "Re-align the motor and pump, then check again once the pump is warm.",
  },
  looseness: {
    name: "Loose mounting",
    part: "base",
    partName: "the mounting bolts",
    story:
      "A bolt or a foot isn't tight, so the pump set rattles on its base instead of sitting still.",
    fix: "Tighten the mounting bolts to specification and check for a foot that rocks.",
  },
  outer_race: {
    name: "Worn bearing (outer ring)",
    part: "bearing",
    partName: "the motor's drive-end bearing",
    story:
      "There is a small pit in the bearing's fixed outer ring, and every ball clicks as it rolls over it.",
    fix: "Plan a bearing replacement at the next maintenance window. Watch the temperature until then.",
  },
  inner_race: {
    name: "Worn bearing (inner ring)",
    part: "bearing",
    partName: "the motor's drive-end bearing",
    story:
      "There is a small pit on the bearing ring that turns with the shaft. This kind of damage usually gets worse faster.",
    fix: "Replace the bearing soon, at the earliest planned stop.",
  },
};

export function faultText(kind: string): FaultText {
  return (
    FAULT_TEXT[kind] ?? {
      name: kind.replace(/_/g, " "),
      part: "none",
      partName: "the machine",
      story: "",
      fix: "",
    }
  );
}

/** The measurement catalogue (`catalog.py`), asked for in plain words. */
export const CHECK_TEXT: Record<string, string> = {
  vib_10s: "Hold a vibration sensor on the motor end of the pump for 10 seconds.",
  envelope: "Keep the sensor on the motor's bearing and record for 30 seconds.",
  half_order: "Move the sensor to the pump's mounting foot and record for 10 seconds.",
  temperature: "Point a thermometer at the bearing housing and read the temperature.",
  coast_down: "Switch the pump off and record while it slows to a stop.",
};

/** What each check returns, named the way a technician would say it. */
export const FEATURE_TEXT: Record<string, string> = {
  ratio_2x_1x: "the 10-second vibration check",
  env_contrast: "the bearing check",
  env_bpfo: "the bearing check",
  env_bpfi: "the bearing check",
  amp_half_x: "the mounting-foot check",
  temp_rise_c: "the temperature check",
  speed_sensitivity: "the slow-down check",
};

/** Engine sentences name features by their code; swap in the plain names. */
export function plainSentence(sentence: string): string {
  let out = sentence;
  for (const [code, words] of Object.entries(FEATURE_TEXT)) out = out.split(code).join(words);
  for (const [kind, text] of Object.entries(FAULT_TEXT)) {
    out = out.split(kind.replace(/_/g, " ")).join(text.name.toLowerCase());
  }
  return out;
}

export const SCENARIOS: { id: string; label: string; hint: string }[] = [
  { id: "mystery", label: "Mystery fault", hint: "A hidden fault is picked at random. Can Crux find it?" },
  { id: "healthy", label: "Healthy pump", hint: "Nothing is wrong. Does Crux raise a false alarm?" },
  { id: "imbalance", label: "Rotor out of balance", hint: "" },
  { id: "misalignment", label: "Shafts out of line", hint: "" },
  { id: "looseness", label: "Loose mounting", hint: "" },
  { id: "outer_race", label: "Worn bearing, outer ring", hint: "" },
  { id: "inner_race", label: "Worn bearing, inner ring", hint: "" },
];

export const SEVERITY_LEVELS: { label: string; value: number }[] = [
  { label: "Mild", value: 0.35 },
  { label: "Moderate", value: 0.6 },
  { label: "Severe", value: 1.0 },
];

export const FAULT_IDS = [
  "healthy",
  "imbalance",
  "misalignment",
  "looseness",
  "outer_race",
  "inner_race",
];

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export function ranked(inv: Investigation): Hypothesis[] {
  return [...inv.hypotheses].sort((a, b) => b.posterior - a.posterior);
}

export function leader(inv: Investigation): Hypothesis {
  return ranked(inv)[0];
}

/** Live suspects, strongest first. */
export function live(inv: Investigation): Hypothesis[] {
  return ranked(inv).filter((h) => !h.rejected);
}

export function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
