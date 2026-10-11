import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { catalogue, getCase, health } from "../api/crux";
import type { CatalogTest, Health, Investigation } from "../api/types";

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

// Read once per page load: the catalogue and the model line-up don't change.
let healthOnce: Promise<Health> | null = null;
let catalogueOnce: Promise<CatalogTest[]> | null = null;

export function useHealth() {
  return useAsync(() => {
    healthOnce ??= health().catch((e) => {
      healthOnce = null;
      throw e;
    });
    return healthOnce;
  }, []);
}

export function useCatalogue() {
  return useAsync(() => {
    catalogueOnce ??= catalogue().catch((e) => {
      catalogueOnce = null;
      throw e;
    });
    return catalogueOnce;
  }, []);
}

/**
 * A case, kept fresh while it waits for a reading: the phone answers through
 * the server, so the case page learns of it by reading the case again.
 */
export function useCase(id: string | undefined, poll: boolean, everyMs = 1500) {
  const [inv, setInv] = useState<Investigation | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const live = useRef(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const next = await getCase(id);
      if (live.current) {
        setInv(next);
        setError(null);
      }
    } catch (e) {
      if (live.current) setError(e as Error);
    }
  }, [id]);

  useEffect(() => {
    live.current = true;
    setInv(null);
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (!poll || !id) return;
    const t = window.setInterval(load, everyMs);
    return () => window.clearInterval(t);
  }, [poll, id, everyMs, load]);

  return { inv, setInv, error, reload: load };
}

/** Respect the visitor's reduced-motion setting everywhere motion explains something. */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false,
  );
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduce(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduce;
}
