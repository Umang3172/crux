// The one authored moment of a result: it plays the first time this browser
// sees it, and shows the same numbers still afterwards or under reduced motion.

import { useEffect, useState } from "react";
import { getWorld, markSeen } from "../../demo/world";
import { useReducedMotion } from "../../lib/hooks";

export function usePlayOnce(key: string): boolean {
  const reduce = useReducedMotion();
  const [first] = useState(() => !getWorld().seen[key]);
  useEffect(() => markSeen(key), [key]);
  return first && !reduce;
}
