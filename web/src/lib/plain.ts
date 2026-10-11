// Plain words. Everything a visitor reads comes from here or from a number or
// sentence the engine returned. The wording explains; it never adds a claim
// the engine did not make. Fault ids match the engine's names.

import type { Hypothesis, Investigation, TestId } from "../api/types";

/** Where on the machine a cause lives, so the scene can point at it. */
export type Part = "impeller" | "coupling" | "feet" | "bearing-inner" | "bearing-outer" | "bearing-ball" | "bearing" | "aux" | "none";

export type FaultText = {
  name: string;
  technical: string;
  part: Part;
  partName: string;
  story: string;
};

export const FAULTS: Record<string, FaultText> = {
  healthy: {
    name: "Nothing wrong",
    technical: "healthy",
    part: "none",
    partName: "the whole pump set",
    story: "The pump is running the way a healthy one does.",
  },
  imbalance: {
    name: "Out of balance",
    technical: "imbalance",
    part: "impeller",
    partName: "the impeller",
    story: "A heavy spot on the spinning impeller makes it wobble once every turn.",
  },
  misalignment: {
    name: "Out of line",
    technical: "misalignment",
    part: "coupling",
    partName: "the coupling between motor and pump",
    story: "The motor and pump shafts don't line up, so the coupling flexes twice every turn.",
  },
  looseness: {
    name: "Loose mounting",
    technical: "looseness",
    part: "feet",
    partName: "the mounting feet",
    story: "A bolt or a foot isn't tight, so the set rattles on its base.",
  },
  outer_race: {
    name: "Worn bearing, outer ring",
    technical: "outer race",
    part: "bearing-outer",
    partName: "the drive-end bearing's outer ring",
    story: "A small pit in the bearing's fixed outer ring: every ball clicks as it rolls over it.",
  },
  inner_race: {
    name: "Worn bearing, inner ring",
    technical: "inner race",
    part: "bearing-inner",
    partName: "the drive-end bearing's inner ring",
    story: "A small pit on the ring that turns with the shaft. This damage usually grows faster.",
  },
  rolling_element: {
    name: "Damaged rolling element",
    technical: "rolling element",
    part: "bearing-ball",
    partName: "one of the bearing's balls",
    story: "A damaged ball strikes both rings once per spin.",
  },
  rolling_element_defect: {
    name: "Damaged rolling element",
    technical: "rolling element defect",
    part: "bearing-ball",
    partName: "one of the bearing's balls",
    story: "A damaged ball strikes both rings once per spin, carried round by the cage.",
  },
  auxiliary_seal_flush_pump: {
    name: "Seal-flush pump",
    technical: "auxiliary seal-flush pump",
    part: "aux",
    partName: "the belt-driven seal-flush pump",
    story: "A small pump driven from the main shaft by a belt; its lobes knock 5.7 times per turn.",
  },
  unlisted_impact: {
    name: "An impact no listed part explains",
    technical: "unlisted impact",
    part: "none",
    partName: "the machine",
    story: "",
  },
  aux_pump: {
    name: "Seal-flush pump",
    technical: "auxiliary seal-flush pump",
    part: "aux",
    partName: "the belt-driven seal-flush pump",
    story: "",
  },
};

export function fault(kind: string): FaultText {
  return (
    FAULTS[kind] ?? {
      name: kind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
      technical: kind.replace(/_/g, " "),
      part: "none",
      partName: "the machine",
      story: "",
    }
  );
}

/** "Worn bearing, inner ring (inner race)": plain first, then the technical name. */
export function faultFull(kind: string): string {
  const f = fault(kind);
  return f.technical && f.technical !== f.name.toLowerCase() ? `${f.name} (${f.technical})` : f.name;
}

/** The checks, in plain words. The engine's names stay in the evidence layer. */
export const CHECKS: Record<TestId, { name: string; short: string; where: string; kind: "capture" | "typed" }> = {
  vib_10s: { name: "10-second vibration reading", short: "10-second reading", where: "the drive-end bearing", kind: "capture" },
  envelope: {
    name: "30-second envelope reading",
    short: "30-second envelope reading",
    where: "the drive-end bearing",
    kind: "capture",
  },
  half_order: { name: "Looseness check", short: "looseness check", where: "the drive end", kind: "capture" },
  temperature: { name: "Housing temperature", short: "temperature check", where: "the bearing housing", kind: "typed" },
  coast_down: { name: "Coast-down", short: "coast-down", where: "the drive end, during a brief stop", kind: "typed" },
};

export const check = (id: string) => CHECKS[id as TestId] ?? { name: id, short: id, where: "", kind: "typed" as const };

/** The engine names features by their code; swap in what a person would say. */
const FEATURES: Record<string, string> = {
  ratio_2x_1x: "the 10-second reading",
  env_contrast: "the envelope reading",
  env_bpfo: "the envelope reading",
  env_bpfi: "the envelope reading",
  amp_half_x: "the looseness check",
  temp_rise_c: "the temperature rise",
  speed_sensitivity: "the coast-down",
};

export function plainSentence(s: string): string {
  let out = s;
  for (const [code, words] of Object.entries(FEATURES)) out = out.split(code).join(words);
  // The engine's change-of-mind line names a temperature rise in °C above the air around the housing.
  out = out.replace(/the temperature rise coming back below ([\d.]+)/g, (_m, v: string) => `the bearing housing reading less than ${Number(v).toFixed(1)} °C above the air around it`);
  // "Healthy" as a suspect is a healthy pump.
  out = out.replace(/^Healthy explained/, "A healthy pump explained");
  // Information is measured in nats; a visitor reads it as information.
  out = out.replace(/\bnats a minute\b/g, "units of information a minute").replace(/\bnats\b/g, "units of information");
  return out;
}

export const ranked = (inv: Investigation): Hypothesis[] => [...inv.hypotheses].sort((a, b) => b.posterior - a.posterior);
export const leader = (inv: Investigation): Hypothesis | undefined => ranked(inv)[0];

/** The bar the engine needs before it names a cause. */
export const CONCLUDE_AT = 0.8;

export const SOURCE_LABEL: Record<string, string> = {
  sensor: "sensor",
  physics: "physics",
  virtual_experiment: "virtual experiment",
  human_measurement: "person",
};
