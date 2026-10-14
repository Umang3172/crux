// The tour's state: which tour, which step. Kept outside any page so the tour
// survives moving from page to page, which is most of what it does.

import { useSyncExternalStore } from "react";

export type TourCtx = {
  /** Go to a page (a hash route such as "/plant"). */
  go: (to: string) => void;
};

export type TourStep = {
  id: string;
  title: string;
  /** One or two short sentences. The screen does the rest. */
  body: string;
  /** Be on this page before the step shows. A function reads it when the step starts. */
  route?: string | (() => string | null);
  /** The element the step points at (a CSS selector). Without one the card sits in the middle. */
  target?: string;
  /** Set the scene before the step shows (a view, say). Runs every time the step starts. */
  before?: () => void;
  /** Something real the tour does as the step starts. Never a pretend action. */
  enter?: (ctx: TourCtx) => void | Promise<void>;
  /** "Next" waits until this is true. */
  ready?: () => boolean;
  /** Move on without a click once `ready` is true. */
  auto?: boolean;
  /** The visitor's turn: the step is over when this turns true. `enter` is then only run if they ask the tour to do it for them. */
  theirs?: () => boolean;
};

type State = { steps: TourStep[]; at: number } | null;

let state: State = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const useTour = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );

export function startTour(steps: TourStep[]) {
  state = { steps, at: 0 };
  emit();
}

export function stopTour() {
  state = null;
  emit();
}

export function tourTo(at: number) {
  if (!state) return;
  if (at >= state.steps.length) return stopTour();
  state = { ...state, at: Math.max(0, at) };
  emit();
}
