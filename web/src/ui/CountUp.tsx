// A number that counts to its new value when the engine moves it, so the
// eye sees the change and its size. Static under reduced motion.

import { animate } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../lib/hooks";

export function CountUp({
  value,
  format,
  duration = 0.9,
}: {
  value: number;
  format: (v: number) => string;
  duration?: number;
}) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduce) {
      setShown(value);
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setShown(v),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, reduce, duration]);
  return <>{format(shown)}</>;
}
