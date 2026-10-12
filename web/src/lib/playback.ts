// Playing a run back, one tool call at a time. A step has up to four beats:
// the case changes hands, the call goes out, the answer comes back, a rest.
// The same player follows a run that is still streaming: it waits where the
// run has got to, and moves on when the next step or answer arrives.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentStep } from "../api/types";

export type Beat = "handoff" | "ask" | "wait" | "answer" | "rest";

export type Play = {
  /** The step on stage; -1 before the first. */
  at: number;
  beat: Beat;
  /** How far through the beat, 0 to 1. */
  p: number;
  playing: boolean;
  /** Everything there is has been shown, and no more is coming. */
  ended: boolean;
};

const FULL: Record<Beat, number> = { handoff: 620, ask: 640, wait: 0, answer: 640, rest: 460 };
const QUICK: Record<Beat, number> = { handoff: 90, ask: 80, wait: 0, answer: 80, rest: 20 };

/** How long the quick player takes over a finished run, in milliseconds. */
export function quickDuration(steps: AgentStep[]): number {
  let ms = 0;
  steps.forEach((s, i) => {
    if (i > 0 && steps[i - 1].agent !== s.agent) ms += QUICK.handoff;
    ms += QUICK.ask + (s.kind === "says" ? 0 : QUICK.answer) + QUICK.rest;
  });
  return ms;
}

export function usePlayback(steps: AgentStep[], opts: { streaming: boolean; quick?: boolean; autoplay?: boolean; speed?: number; runKey: string }) {
  const { streaming, quick = false, autoplay = true, speed = 1, runKey } = opts;
  const state = useRef<Play>({ at: -1, beat: "rest", p: 1, playing: autoplay, ended: false });
  const live = useRef({ steps, streaming, quick, speed });
  live.current = { steps, streaming, quick, speed };
  const [, bump] = useState(0);
  const redraw = useCallback(() => bump((n) => n + 1), []);

  // A different run starts from the top.
  useEffect(() => {
    state.current = { at: -1, beat: "rest", p: 1, playing: autoplay, ended: false };
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(120, now - last);
      last = now;
      const s = state.current;
      const { steps: all, streaming: more, quick: fast, speed: rate } = live.current;
      if (s.playing) {
        const beats = fast ? QUICK : FULL;
        const step = all[s.at];
        const length = step?.kind === "says" && s.beat === "rest" && !fast ? 760 : beats[s.beat];
        if (s.beat !== "wait" && s.p < 1) {
          s.p = length <= 0 ? 1 : Math.min(1, s.p + (dt * rate) / length);
        } else if (s.beat === "handoff") {
          Object.assign(s, { beat: "ask", p: 0 });
        } else if (s.beat === "ask") {
          if (step?.kind === "says") Object.assign(s, { beat: "rest", p: 0 });
          else if (step?.answered != null) Object.assign(s, { beat: "answer", p: 0 });
          else if (more) Object.assign(s, { beat: "wait", p: 1 });
          else Object.assign(s, { beat: "rest", p: 0 });
        } else if (s.beat === "wait") {
          if (step?.answered != null) Object.assign(s, { beat: "answer", p: 0 });
          else if (!more) Object.assign(s, { beat: "rest", p: 0 });
        } else if (s.beat === "answer") {
          Object.assign(s, { beat: "rest", p: 0 });
        } else if (s.at + 1 < all.length && all[s.at + 1]) {
          const next = all[s.at + 1];
          const changed = s.at >= 0 && all[s.at]?.agent !== next.agent;
          Object.assign(s, { at: s.at + 1, beat: changed ? "handoff" : "ask", p: 0 });
        } else if (!more && !s.ended) {
          Object.assign(s, { ended: true, playing: false });
        } else {
          // Caught up with a run that is still going: nothing to draw until more arrives.
          raf = requestAnimationFrame(tick);
          return;
        }
        redraw();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [redraw]);

  const set = (patch: Partial<Play>) => {
    Object.assign(state.current, patch);
    redraw();
  };

  return {
    play: state.current,
    start: () => set({ playing: true, ended: false }),
    pause: () => set({ playing: false }),
    restart: () => set({ at: -1, beat: "rest", p: 1, playing: true, ended: false }),
    /** Jump to a step and hold it with its answer showing. */
    seek: (i: number) => set({ at: Math.max(-1, Math.min(live.current.steps.length - 1, i)), beat: "rest", p: 1, playing: false, ended: false }),
    /** Show the whole run as finished. */
    finish: () => set({ at: live.current.steps.length - 1, beat: "rest", p: 1, playing: false, ended: !live.current.streaming }),
  };
}
