// One door to the server. Cloud Run sleeps when idle, so the first request
// can take seconds: a slow request flips `waking` so the shell can say
// "Waking the engine…" instead of showing an error.

const env = import.meta.env;
export const BASE: string = env.VITE_API_BASE ?? (env.DEV ? "http://localhost:8080" : "");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly path: string,
  ) {
    super(detail || `HTTP ${status}`);
  }
}

type Listener = (waking: boolean) => void;
const listeners = new Set<Listener>();
let slow = 0;
let wakingNow = false;

function setWaking(next: boolean) {
  if (next === wakingNow) return;
  wakingNow = next;
  listeners.forEach((l) => l(next));
}

export function onWaking(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const isWaking = () => wakingNow;

const SLOW_MS = 2500;

/** A quiet request is slow by design (a model writing, a run of experiments): it never says the engine is asleep. */
export type RequestOpts = { quiet?: boolean };

async function request<T>(method: "GET" | "POST", path: string, body?: unknown, signal?: AbortSignal, opts: RequestOpts = {}): Promise<T> {
  let flagged = false;
  const timer = setTimeout(() => {
    if (opts.quiet) return;
    flagged = true;
    slow += 1;
    setWaking(true);
  }, SLOW_MS);
  try {
    const res = await fetch(BASE + path, {
      method,
      signal,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const j = await res.json();
        detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
      } catch {
        detail = res.statusText;
      }
      throw new ApiError(res.status, detail, path);
    }
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ApiError || (e instanceof DOMException && e.name === "AbortError")) throw e;
    // fetch rejects only when the server could not be reached at all.
    throw new ApiError(0, "The engine could not be reached.", path);
  } finally {
    clearTimeout(timer);
    if (flagged) {
      slow -= 1;
      if (slow === 0) setWaking(false);
    }
  }
}

export const get = <T>(path: string, signal?: AbortSignal, opts?: RequestOpts) => request<T>("GET", path, undefined, signal, opts);
export const post = <T>(path: string, body?: unknown, signal?: AbortSignal, opts?: RequestOpts) =>
  request<T>("POST", path, body ?? {}, signal, opts);

export const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.set(k, String(v));
  return u.toString();
};
