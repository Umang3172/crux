import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ApiError } from "../api/client";
import { agentAbout, catalogue, getCase, health } from "../api/crux";
import type { AgentAbout, CatalogTest, Health, Investigation } from "../api/types";
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

export type Theme = "dark" | "light";
const THEME_KEY = "crux.theme";

function storedTheme(): Theme {
  try {
    const t = window.localStorage.getItem(THEME_KEY);
    if (t === "dark" || t === "light") return t;
  } catch {
    /* fall through */
  }
  return "dark";
}

export function applyStoredTheme() {
  document.documentElement.dataset.theme = storedTheme();
  // index.html paints a ground colour before the bundle loads; from here the tokens own it.
  document.documentElement.style.removeProperty("background");
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* the choice lasts for this page only */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
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
