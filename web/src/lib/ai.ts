// Which model runs each AI job, read from the server's own report (/health).
// "Configured", not "answered": the server does not say when a job last
// answered, so the console does not claim it did.

import type { Models } from "../api/types";

export type Brain = { name: string; live: boolean };

export function brainOf(configured: string | undefined): Brain {
  if (!configured) return { name: "unknown", live: false };
  if (configured.startsWith("gemini")) return { name: configured, live: true };
  if (configured.startsWith("ollama")) return { name: `local model (${configured.split(":").slice(1).join(":") || "Ollama"})`, live: true };
  if (configured === "off" || configured.startsWith("off (")) return { name: "off", live: false };
  return { name: "offline stand-in", live: false };
}

export const AI_JOBS: { key: keyof Models & string; label: string; does: string; instead: string }[] = [
  {
    key: "investigator",
    label: "Investigator and critic",
    does: "Drive the physics tools on an investigation, and may write one missing suspect.",
    instead: "A scripted stand-in drives the same tools, so the physics still decides.",
  },
  {
    key: "gate",
    label: "Gate",
    does: "Decides who goes next, or stops the investigation.",
    instead: "Rules in code. Never given to a model.",
  },
  {
    key: "report_writer",
    label: "Explanation writer",
    does: "Writes the plain-words sentences beside a verdict, each checked against its evidence.",
    instead: "The engine's own sentences are the whole answer.",
  },
  {
    key: "ticket_writer",
    label: "Work-order writer",
    does: "Drafts a work order from a forecast alarm.",
    instead: "A template fills it from the engine's numbers.",
  },
  {
    key: "camera_look",
    label: "Camera look",
    does: "Looks at a still for visible damage. What it reports stays unconfirmed.",
    instead: "Nobody has looked at the photo; the work order says so.",
  },
  {
    key: "lens_look",
    label: "Phone-scan look",
    does: "Names the machine in a phone video and reads its nameplate.",
    instead: "Nothing names the machine or reads its nameplate.",
  },
  {
    key: "lesson_writer",
    label: "Lesson writer",
    does: "Turns what a repair found into a lesson.",
    instead: "A template writes the lesson from what was found.",
  },
];

/** The reason a job is not on a live model, when the server recorded one. */
export function fallbackReason(models: Models, key: string): string | null {
  return (models as Record<string, string>)[`${key}_not_live`] ?? null;
}

/** How an agent run names its model, shortened for a badge. */
export function runBrain(model: string, live: boolean): Brain {
  if (live) return { name: model, live: true };
  return { name: "offline stand-in", live: false };
}
