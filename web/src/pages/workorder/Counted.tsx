// A number that arrives at its value from another one when the result is first
// seen, and simply shows its value after that.

import { useEffect, useState } from "react";
import { CountUp } from "../../ui/CountUp";

export function Counted({ value, from, play, format }: { value: number; from: number; play: boolean; format: (v: number) => string }) {
  const [shown, setShown] = useState(play ? from : value);
  useEffect(() => setShown(value), [value]);
  return <CountUp value={shown} format={format} />;
}
