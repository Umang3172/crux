// Who is running each AI job, read from the server's own report (/health).
// "configured", not "answered": the server does not yet say when each job
// last answered.

import type { Models } from "../api/types";

export type Brain = { name: string; live: boolean };

export function brainOf(configured: string | undefined): Brain {
  if (!configured) return { name: "unknown", live: false };
  if (configured.startsWith("gemini")) return { name: "Gemini", live: true };
  if (configured.startsWith("ollama")) return { name: `local model (${configured.split(":")[1] ?? "Ollama"})`, live: true };
  if (configured === "off" || configured.startsWith("off (")) return { name: "off", live: false };
  return { name: "offline stand-in", live: false };
}

export const AI_JOBS: { key: keyof Models; label: string; instead: string }[] = [
  { key: "investigator", label: "Investigator", instead: "A scripted investigator drives the same tools, so the physics still decides." },
  { key: "report_writer", label: "Explanation writer", instead: "The engine's own sentences are the whole answer." },
  { key: "ticket_writer", label: "Work-order writer", instead: "A template fills the work order from the engine's numbers." },
  { key: "camera_look", label: "Camera look", instead: "Nobody has looked at the photo yet; the work order says so." },
  { key: "lens_look", label: "Lens look", instead: "The person draws a box round the machine." },
  { key: "lesson_writer", label: "Lesson writer", instead: "A template writes the lesson from what was found." },
];

/** The reason a job fell back, when the server recorded one. */
export function fallbackReason(models: Models, key: string): string | null {
  const reason = (models as Record<string, string>)[`${key}_not_live`];
  return reason ?? null;
}
