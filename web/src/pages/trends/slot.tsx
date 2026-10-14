// What every Trends screen shares: a view that is loading, missing or failed,
// and a chart sized to the room left on the screen so the page does not scroll.

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { ApiError } from "../../api/client";
import type { Async } from "../../lib/hooks";
import { ErrorState, SkeletonRows } from "../../ui/kit";

/** A view the server does not offer here (404) reads as absent, not as an error. */
const absent = <T,>(a: Async<T>) => a.error instanceof ApiError && a.error.status === 404;

export function Slot<T>({ a, children, rows = 4 }: { a: Async<T>; children: (d: T) => ReactNode; rows?: number }) {
  if (a.error && !absent(a)) return <ErrorState error={a.error} onRetry={a.reload} />;
  if (absent(a)) return <p className="muted small tn-absent">{a.error?.message}</p>;
  if (!a.data) return <SkeletonRows rows={rows} />;
  return <>{children(a.data)}</>;
}

/** The height that fills the window below `ref`, leaving `below` pixels for what follows. */
export function useFitHeight(ref: RefObject<HTMLElement | null>, below: number, min = 200, max = 420): number {
  const [h, setH] = useState(min);
  useEffect(() => {
    const fit = () => {
      const top = ref.current?.getBoundingClientRect().top ?? 0;
      setH(Math.round(Math.max(min, Math.min(max, window.innerHeight - top - below))));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [ref, below, min, max]);
  return h;
}

export const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
export const peak = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.max(...v) : null;
};
export const num = (x: number | null, unit = "") => (x === null ? "–" : `${x.toFixed(1)}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`);
