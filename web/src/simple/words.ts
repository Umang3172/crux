// What the simple view says about a machine, in a few plain words. It reads
// the console's own status (lib/plant.ts) and the case the engine returned;
// it adds no claim of its own.

import type { CaseModel } from "../lib/casemodel";
import { check, fault } from "../lib/plain";
import type { CaseEntry } from "../lib/session";
import type { MachineStatus, PlantMachine } from "../lib/plant";

/** act: someone should look; calm: nothing to do; busy: Crux is working. */
export type Mood = "act" | "calm" | "busy";

export type Said = { short: string; mood: Mood; line: string; detail: string };

/** A case the server no longer holds can't take its measurement: treat the machine as not yet checked. */
export const usable = (entry: CaseEntry | undefined, model: CaseModel | null) => (entry?.lost && model?.status === "waiting" ? null : model);

/** A name that never breaks at its hyphen: "pump P-2" stays on one line. */
export const keep = (name: string) => name.replace(/-/g, "\u2011");

export function sayStatus(m: PlantMachine, st: MachineStatus, model: CaseModel | null): Said {
  if (st.busy) return { short: "Crux is investigating", mood: "busy", line: "Crux is testing every possible cause.", detail: "Each one is tried on a virtual copy of this machine and compared with the real reading." };

  if (m.mode === "model") {
    if (!model) return { short: "Not checked yet", mood: "calm", line: "This machine hasn't been checked yet.", detail: "Ask Crux to read it and find out whether anything is wrong." };
    if (model.hazard) return { short: "Hazard reported", mood: "act", line: "Someone reported a hazard on this machine.", detail: "Make it safe first. The full investigation has the note." };
    if (model.status === "waiting") {
      const w = model.checks.find((c) => c.status === "waiting");
      return {
        short: "Needs one measurement",
        mood: "act",
        line: "Two causes still fit. One measurement will tell them apart.",
        detail: w ? `${check(w.testId).name}${w.minutes ? `, about ${Math.round(w.minutes)} minutes` : ""}${w.downtime === "none" ? ", with the machine running" : ""}.` : "Crux has asked for one reading.",
      };
    }
    if (model.status === "unresolved") return { short: "Cause unclear", mood: "act", line: "Something is wrong, but nothing Crux knows explains it.", detail: model.unresolvedReason ?? "Inspect the machine before opening it up." };
    if (model.status === "concluded" && model.leader) {
      if (model.leader.kind === "healthy") return { short: "Running normally", mood: "calm", line: "Nothing is wrong with this machine.", detail: "Its vibration matches a healthy machine." };
      const f = fault(model.leader.kind);
      return { short: f.name, mood: "act", line: `Crux found the cause: ${f.name.toLowerCase()}.`, detail: f.story };
    }
    return { short: "Crux is investigating", mood: "busy", line: "Crux is testing every possible cause.", detail: "" };
  }

  if (m.mode === "life") return { short: st.owner ? st.label : "Health watched", mood: st.owner ? "act" : "calm", line: "Crux follows this part's health from new.", detail: "Open its history to see how the health fell and when Crux raised the alarm." };
  if (m.mode === "live") return { short: st.label, mood: "calm", line: "A sensor on this motor sends its vibration to Crux.", detail: "A full capture gets the same investigation as any other machine." };
  return { short: st.owner ? st.label : "No sensor fitted", mood: st.owner ? "act" : "calm", line: "Nothing is fitted to this machine.", detail: "A ten-second phone video is its only reading." };
}
