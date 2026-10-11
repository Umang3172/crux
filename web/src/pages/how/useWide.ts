import { useEffect, useState } from "react";

/** True while the viewport is wide enough for the seven tags to hang in one row. */
export function useWide(min = 1100): boolean {
  const query = `(min-width: ${min}px)`;
  const [wide, setWide] = useState(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : true));
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return wide;
}
