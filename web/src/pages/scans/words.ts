// Words and small helpers for scans: the camera look (a model's reading) and
// the physics reading (the engine's) stay apart, and each carries its source.

import { ApiError } from "../../api/client";
import type { CameraLook, Scan, ScanAnalysis } from "../../api/types";
import { num } from "../../lib/format";
// One place scrubs server paths out of messages; the update page owns it.
import { failure } from "../network/words";

/** Fault names as the server's own Lens sentences say them, so a list and its summary agree. */
const KIND_LABEL: Record<string, string> = {
  healthy: "running normally",
  imbalance: "out of balance",
  misalignment: "shafts out of line",
  looseness: "loose mounting",
  outer_race: "bearing outer ring damage",
  inner_race: "bearing inner ring damage",
};

export const kindLabel = (kind: string) => KIND_LABEL[kind] ?? kind.replace(/_/g, " ");
export const upperFirst = (t: string) => t.replace(/^./, (c) => c.toUpperCase());

/** The link a phone opens to scan a machine, with its name filled in when known. */
export function phoneLensUrl(machine?: string): string {
  const { origin, pathname } = window.location;
  const q = machine ? `?machine=${encodeURIComponent(machine)}` : "";
  return `${origin}${pathname}#/phone/lens${q}`;
}

/** An older scan may lack fields the look has now, and a scan made with the look skipped has none at all. */
export const lookOf = (scan: Scan): Partial<CameraLook> => scan.look as Partial<CameraLook>;

/** The model that looked, named as the page names its brains; null when nobody did. */
export function lookedBy(by: string | undefined): string | null {
  if (!by || by === "offline" || by === "nobody") return null;
  if (by.startsWith("gemini")) return "Gemini";
  if (by.startsWith("ollama:")) return `local model (${by.split(":")[1] ?? "Ollama"})`;
  return by;
}

// The server's summary opens with two sentences that come from the camera look,
// not from the physics. They are a model's words, so they are shown in its
// block and left out of the engine's.
const FROM_THE_LOOK = ["Seen in the video (unconfirmed", "The photo check needs a new photo"];

export const isFromLook = (sentence: string): boolean => FROM_THE_LOOK.some((p) => sentence.startsWith(p));

export const physicsSentences = (analysis: ScanAnalysis): string[] => analysis.summary.filter((t) => !isFromLook(t));

export const hz = (x: number) => `${num(x, 1)} Hz`;
export const fps = (x: number) => `${Math.round(x)} frames a second`;
export const seconds = (x: number) => `${num(x, 1)} s`;

/** Pixels of movement, with enough digits for the small lines to read as small. */
export const px = (x: number) => `${num(x, x >= 0.1 ? 2 : 3)} px`;

export const orderText = (order: number) => `${order}×`;

/** The main direction of shaking, 0 being left to right and 90 up and down in the upright frame. */
export function directionWords(deg: number): string {
  const d = ((deg % 180) + 180) % 180;
  if (d < 20 || d > 160) return "mostly left and right";
  if (d > 70 && d < 110) return "mostly up and down";
  return "at an angle";
}

export const STATUS_WORD: Record<string, string> = {
  present: "Seen",
  absent: "Not seen",
  unsure: "Unsure",
  cannot_see: "Can't see",
};

/** What went wrong with a scan, in words a person on a phone can act on. A 422 detail carries a server folder, so it is never shown. */
export function lensFailure(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.status === 413) return "The server refused the video as too large. Keep it to about ten seconds.";
    if (e.status === 422) return "Crux could not read this video. Record it again, or choose a different file.";
    if (e.status === 501) return "This server can't read video: video support isn't installed on it.";
    if (e.status === 400) return "The video arrived empty. Record it again, or choose a different file.";
    if (e.status === 404) return "This scan is no longer on the server.";
  }
  return failure(e, fallback);
}
