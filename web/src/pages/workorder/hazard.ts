// A reported hazard on a work order. The engine words it; a person said it;
// and it stays on until a person acknowledges it by name (the banner takes that).

import type { Note } from "../../api/types";
import type { World } from "../../demo/world";

export type HazardOn = {
  /** The engine's sentence, or the camera's, when the hazard came from a photo. */
  text: string;
  /** What people wrote that raised it. */
  notes: Note[];
  /** Whether a person can acknowledge it from the banner: only hazards raised in this browser. */
  ackable: boolean;
  ack?: { by: string; at: number };
};

export function hazardOn(w: World, caseId: string | undefined, text: string | null, notes: Note[]): HazardOn | null {
  const raised = caseId ? w.hazards.find((h) => h.caseId === caseId) : undefined;
  const said = text ?? raised?.text ?? null;
  if (!said) return null;
  const ack = raised ? w.acks.find((a) => a.caseId === caseId && a.at >= raised.at) : undefined;
  return { text: said, notes: notes.filter((n) => n.hazards.length > 0), ackable: raised !== undefined, ack: ack && { by: ack.by, at: ack.at } };
}
