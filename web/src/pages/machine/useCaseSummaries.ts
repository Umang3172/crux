// This browser's cases on one machine, read from the server once and kept
// fresh while any of them waits for a reading (the phone answers through the
// server, so the page learns of it by reading the case again). A 404 means the
// server restarted and forgot the case.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { getCase } from "../../api/crux";
import type { CaseEntry, World } from "../../demo/world";
import { summarise, type CaseSummary, type Loaded } from "./nowStatus";

const EVERY_MS = 3000;

export function useCaseSummaries(entries: CaseEntry[], runs: World["runs"]): CaseSummary[] {
  const [loads, setLoads] = useState<Record<string, Loaded>>({});
  const seen = useRef(loads);
  seen.current = loads;
  const ids = entries.filter((e) => e.kind === "engine").map((e) => e.id);
  const key = ids.join("|");

  const read = useCallback(async (id: string) => {
    try {
      const inv = await getCase(id);
      setLoads((m) => ({ ...m, [id]: { phase: "ready", inv } }));
    } catch (e) {
      setLoads((m) => ({ ...m, [id]: e instanceof ApiError && e.status === 404 ? { phase: "lost" } : { phase: "error" } }));
    }
  }, []);

  useEffect(() => {
    for (const id of ids) {
      if (seen.current[id]) continue;
      setLoads((m) => ({ ...m, [id]: { phase: "loading" } }));
      void read(id);
    }
    // `ids` is read through its joined key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, read]);

  useEffect(() => {
    if (ids.length === 0) return;
    const timer = window.setInterval(() => {
      for (const id of ids) {
        const l = seen.current[id];
        if (l?.phase === "error" || (l?.phase === "ready" && l.inv.outcome === "open")) void read(id);
      }
    }, EVERY_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, read]);

  return useMemo(() => entries.map((e) => summarise(e, loads[e.id], runs[e.id]?.run)), [entries, loads, runs]);
}
