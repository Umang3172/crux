import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { ApiError } from "../api/client";
import { agentAbout, catalogue, getCase, health, machineModel } from "../api/crux";
import type { AgentAbout, CatalogTest, Health, Investigation, MachineModel } from "../api/types";
import { patchCase, rememberInvestigation } from "./session";

export type Async<T> = { data: T | null; error: ApiError | Error | null; loading: boolean; reload: () => void };

export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[]): Async<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    fn(ctl.signal)
      .then((d) => !ctl.signal.aborted && setData(d))
      .catch((e) => !ctl.signal.aborted && !(e instanceof DOMException) && setError(e))
      .finally(() => !ctl.signal.aborted && setLoading(false));
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

// Read once per page load: the catalogue, the model line-up and the agents'
// tool lists do not change while the server runs.
function once<T>(load: () => Promise<T>) {
  let p: Promise<T> | null = null;
  return () => {
    p ??= load().catch((e) => {
      p = null;
      throw e;
    });
    return p;
  };
}
const healthOnce = once<Health>(health);
const catalogueOnce = once<CatalogTest[]>(catalogue);
const aboutOnce = once<AgentAbout>(agentAbout);

const machineOnce = once<MachineModel | null>(machineModel);

export const useMachineModel = () => useAsync(machineOnce, []);
export const useHealth = () => useAsync(healthOnce, []);
export const useCatalogue = () => useAsync(catalogueOnce, []);
export const useAbout = () => useAsync(aboutOnce, []);

/**
 * An engine case, kept in step with the server. While it waits for a reading
 * it is read again every so often, because a phone answers through the server.
 * A case the server no longer has is marked lost; its last known state stays.
 */
export function useLiveCase(id: string | undefined, enabled: boolean, poll: boolean) {
  const [error, setError] = useState<Error | null>(null);
  const load = useCallback(async (): Promise<Investigation | null> => {
    if (!id) return null;
    try {
      const inv = await getCase(id);
      rememberInvestigation(inv);
      setError(null);
      return inv;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) patchCase(id, { lost: true });
      else setError(e as Error);
      return null;
    }
  }, [id]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled || !poll) return;
    const t = window.setInterval(load, 1500);
    return () => window.clearInterval(t);
  }, [enabled, poll, load]);

  return { error, reload: load };
}

/** The width of an element, for charts drawn to the pixel. */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => setWidth(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function useHotkey(test: (e: KeyboardEvent) => boolean, run: () => void) {
  const fn = useRef(run);
  fn.current = run;
  const match = useRef(test);
  match.current = test;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (match.current(e)) {
        e.preventDefault();
        fn.current();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
}

export type Theme = "light" | "dark";
// A new key: the old console stored "dark" as its default, and this app opens light.
const THEME_KEY = "crux.theme.v2";
const GROUND: Record<Theme, string> = { light: "#fafaf9", dark: "#0c0c0b" };

function storedTheme(): Theme {
  try {
    if (window.localStorage.getItem(THEME_KEY) === "dark") return "dark";
  } catch {
    /* fall through */
  }
  return "light";
}

let theme: Theme = typeof window === "undefined" ? "light" : storedTheme();
const themeListeners = new Set<() => void>();
const onTheme = (l: () => void) => {
  themeListeners.add(l);
  return () => themeListeners.delete(l);
};

/** The figures read the theme from the root to pick their inks; the browser's bar takes the ground colour. */
function paint(t: Theme) {
  const root = document.documentElement;
  root.dataset.theme = t;
  // index.html paints a ground colour before the bundle loads; from here the tokens own it.
  root.style.removeProperty("background");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", GROUND[t]);
}

export function applyStoredTheme() {
  paint(theme);
}

/**
 * Turn the page over: light to dark or back. Where the browser can, the new
 * theme opens as a circle from the point pressed (`at`, in the viewport).
 */
export function toggleTheme(at?: { x: number; y: number }) {
  const next: Theme = theme === "dark" ? "light" : "dark";
  const swap = () => {
    theme = next;
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* the choice lasts for this page only */
    }
    paint(next);
    themeListeners.forEach((l) => l());
  };
  const doc = document as Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };
  if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return swap();
  const root = document.documentElement;
  root.style.setProperty("--turn-x", `${at?.x ?? window.innerWidth / 2}px`);
  root.style.setProperty("--turn-y", `${at?.y ?? 0}px`);
  root.classList.add("theme-turning");
  void doc.startViewTransition(swap).finished.finally(() => root.classList.remove("theme-turning"));
}

export function useTheme(): [Theme, typeof toggleTheme] {
  return [useSyncExternalStore(onTheme, () => theme, () => theme), toggleTheme];
}

/** A value that climbs from 0 to `count`, one step at a time: used to replay a finished run in order. */
export function useStepper(count: number, everyMs: number, key: string): [number, () => void, boolean] {
  const [n, setN] = useState(count);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    setN(count);
    setPlaying(false);
  }, [count, key]);
  useEffect(() => {
    if (!playing) return;
    if (n >= count) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => setN((x) => x + 1), everyMs);
    return () => window.clearTimeout(t);
  }, [playing, n, count, everyMs]);
  const play = useCallback(() => {
    setN(0);
    setPlaying(true);
  }, []);
  return [n, play, playing];
}


/** True when the visitor has asked their system for less motion. */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => (typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false));
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduce(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduce;
}

/** Whether an element is on screen, so an animation nobody can see does not run. */
export function useInView<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setSeen(entries[0].isIntersecting), { rootMargin: "80px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen];
}

/** Seconds of running time, advanced once a frame while `running` is true. It holds its value while paused. */
export function useClock(running: boolean): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // A tab left in the background comes back with one long frame; do not jump.
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setT((x) => x + dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);
  return t;
}
