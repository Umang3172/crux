// Small pieces the investigation page shares.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Badge, cx } from "../../ui/kit";

/** A long sentence held to a few lines, with "more" to read the rest. */
export function Clamp({ children, lines = 3, className }: { children: ReactNode; lines?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => setLong(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, children]);
  return (
    <div className={cx("clamp-box", className)}>
      <div ref={ref} className={cx("clamp", open && "open")} style={open ? undefined : { WebkitLineClamp: lines }}>
        {children}
      </div>
      {(long || open) && (
        <button type="button" className="clamp-more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "less" : "more"}
        </button>
      )}
    </div>
  );
}

/** Marks the engine's own sentences, so they are never taken for a model's. */
export function EngineWords() {
  return (
    <Badge tone="accent" plain>
      the engine's words
    </Badge>
  );
}
