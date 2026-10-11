// A request already on its way is not sent twice. A report written by a
// language model takes seconds, and development builds mount every effect twice.

const inflight = new Map<string, Promise<unknown>>();

export function once<T>(key: string, send: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const started = send().finally(() => inflight.delete(key));
  inflight.set(key, started);
  return started;
}
