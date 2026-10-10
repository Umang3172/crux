/**
 * The vibration sensor's trace, scrolling as if it were live.
 *
 * It replays a quarter-second slice of the capture under investigation
 * (`/capture`), so the shape on screen is the reading Crux is diagnosing, not a
 * decorative sine wave.
 */

import { useEffect, useRef, useState } from "react";

const VISIBLE = 220;

export function LiveTrace({ waveform, running }: { waveform: number[]; running: boolean }) {
  const [offset, setOffset] = useState(0);
  const frame = useRef<number>();

  useEffect(() => {
    if (!running || waveform.length < VISIBLE) return;
    let last = performance.now();
    const tick = (now: number) => {
      // About 90 samples a second: slow enough to follow, fast enough to feel live.
      if (now - last > 11) {
        setOffset((o) => (o + 1) % waveform.length);
        last = now;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [running, waveform]);

  if (waveform.length === 0) return <div className="g-trace empty" />;

  const peak = Math.max(...waveform.map((v) => Math.abs(v))) || 1;
  const points = Array.from({ length: VISIBLE }, (_, i) => {
    const v = waveform[(offset + i) % waveform.length];
    return `${((i / (VISIBLE - 1)) * 100).toFixed(2)},${(50 - (v / peak) * 42).toFixed(2)}`;
  }).join(" ");

  return (
    <svg className="g-trace" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="50" x2="100" y2="50" className="g-trace-zero" />
      <polyline points={points} className="g-trace-line" />
    </svg>
  );
}
