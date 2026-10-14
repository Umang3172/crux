// Motion that marks a change. Something that moves glides to its new place,
// something new fades in, a panel that changes size eases to it, and an item
// that leaves a list folds away before it goes. All of it stands still when
// the visitor's system asks for less motion.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "./hooks";

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

type Spot = { x: number; y: number };

/**
 * Children marked `data-flip="<id>"` glide from where they were to where they
 * are after a render, so a list that is re-sorted, filtered or regrouped moves
 * instead of jumping. The container must be the children's offset parent.
 */
export function useFlip<T extends HTMLElement>(ms = 420) {
  const ref = useRef<T | null>(null);
  const last = useRef<Map<string, Spot> | null>(null);
  const reduced = useReducedMotion();

  const measure = () => {
    const out = new Map<string, Spot>();
    ref.current?.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => out.set(el.dataset.flip ?? "", { x: el.offsetLeft, y: el.offsetTop }));
    return out;
  };

  useLayoutEffect(() => {
    const before = last.current;
    const now = measure();
    last.current = now;
    if (!before || reduced) return;
    ref.current?.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const id = el.dataset.flip ?? "";
      const was = before.get(id);
      const at = now.get(id);
      if (!at) return;
      if (!was) {
        el.animate([{ opacity: 0, transform: "scale(0.97)" }, { opacity: 1, transform: "none" }], { duration: 280, easing: EASE });
        return;
      }
      let dx = was.x - at.x;
      let dy = was.y - at.y;
      if (!dx && !dy) return;
      // Already gliding: start from where it is on screen, not from where it was laid out.
      for (const a of el.getAnimations()) {
        if (a.id !== "flip") continue;
        const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        dx += m.m41;
        dy += m.m42;
        a.cancel();
      }
      const glide = el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: ms, easing: EASE });
      glide.id = "flip";
    });
  });

  // A resized window moves things too; that is not a change worth showing.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const ro = new ResizeObserver(() => {
      last.current = measure();
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  return ref;
}

/**
 * A panel whose content changes size eases to its new height. Put the ref on
 * the panel; it must keep one child, which holds whatever is shown.
 */
export function useSmoothHeight<T extends HTMLElement>(ms = 340) {
  const ref = useRef<T | null>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    const inner = el?.firstElementChild as HTMLElement | null;
    if (!el || !inner) return;
    let prev: number | null = null;
    const ro = new ResizeObserver(() => {
      const h = inner.offsetHeight;
      if (prev !== null && prev !== h && !reduced) el.animate([{ height: `${prev}px` }, { height: `${h}px` }], { duration: ms, easing: EASE });
      prev = h;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [reduced, ms]);
  return ref;
}

export type Present<T> = { item: T; key: string; leaving: boolean };

/**
 * A list that lets a removed item fold away before it goes: the item stays,
 * marked as leaving, for `ms`, in the place it had. Style `.leaving` to fold.
 */
export function usePresence<T>(items: T[], keyOf: (t: T) => string, ms = 320): Present<T>[] {
  const reduced = useReducedMotion();
  const sig = items.map(keyOf).join("\u0000");
  const [prev, setPrev] = useState({ sig, items });
  const [leaving, setLeaving] = useState<{ key: string; item: T; after: string | null }[]>([]);

  // Worked out while rendering, so a removed item never blinks out for a frame before it folds.
  if (sig !== prev.sig) {
    const now = new Set(items.map(keyOf));
    const gone = reduced
      ? []
      : prev.items
          .map((t, i) => ({ t, i }))
          .filter(({ t }) => !now.has(keyOf(t)))
          .map(({ t, i }) => ({ key: keyOf(t), item: t, after: i > 0 ? keyOf(prev.items[i - 1]) : null }));
    setPrev({ sig, items });
    setLeaving((l) => [...l.filter((x) => !now.has(x.key) && !gone.some((g) => g.key === x.key)), ...gone]);
  }

  useEffect(() => {
    if (leaving.length === 0) return;
    const t = window.setTimeout(() => setLeaving([]), ms);
    return () => window.clearTimeout(t);
  }, [leaving, ms]);

  const out: Present<T>[] = items.map((item) => ({ item, key: keyOf(item), leaving: false }));
  for (const l of leaving) {
    if (out.some((o) => o.key === l.key)) continue;
    const i = l.after === null ? 0 : out.findIndex((o) => o.key === l.after) + 1;
    out.splice(i <= 0 && l.after !== null ? out.length : i, 0, { item: l.item, key: l.key, leaving: true });
  }
  return out;
}

/**
 * A number that goes up each time `signature` changes after the first render:
 * use it as a key to replay a one-off animation when something's state moves.
 */
export function useChangeCount(signature: string): number {
  const [n, setN] = useState(0);
  const seen = useRef(signature);
  useEffect(() => {
    if (signature === seen.current) return;
    seen.current = signature;
    setN((x) => x + 1);
  }, [signature]);
  return n;
}
