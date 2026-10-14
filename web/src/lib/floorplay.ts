// An investigation can be on screen in two places at once: on its machine's
// tile and on the stage. One player runs for it and both read that player, so
// they always show the same call at the same moment.

import { useSyncExternalStore } from "react";
import type { AgentStep } from "../api/types";
import type { Play } from "./playback";

export type Shown = { play: Play; steps: AgentStep[]; streaming: boolean };

const shown = new Map<string, Shown>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function publishShown(id: string, s: Shown) {
  shown.set(id, s);
  emit();
}

export function withdrawShown(id: string) {
  if (shown.delete(id)) emit();
}

/** Every frame of the player, for the stage. */
export const useShown = (id: string | undefined) =>
  useSyncExternalStore(
    subscribe,
    () => (id ? shown.get(id) : undefined),
    () => undefined,
  );

export type ShownProgress = { at: number; total: number; streaming: boolean; step: AgentStep | undefined };

/** Which call the player is on, out of how many; a tile redraws only when that changes. */
export function useShownProgress(id: string | undefined): ShownProgress | null {
  const key = useSyncExternalStore(
    subscribe,
    () => {
      const s = id ? shown.get(id) : undefined;
      return s ? `${s.play.at}|${s.steps.length}|${s.streaming ? 1 : 0}` : "";
    },
    () => "",
  );
  const s = id && key ? shown.get(id) : undefined;
  if (!s) return null;
  return { at: s.play.at, total: s.steps.length, streaming: s.streaming, step: s.play.at >= 0 ? s.steps[s.play.at] : undefined };
}
