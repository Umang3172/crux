// The seven steps as one diagram. A dot is the case: it travels the rail once,
// each tag takes its class colour as the dot reaches it, and the dot rests on
// the last. Under reduced motion every tag is already lit and nothing travels.

import { animate } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "../../lib/hooks";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { JourneyNode } from "./JourneyNode";
import { layoutOf, type Mode, type Pt } from "./layout";
import { STEPS } from "./steps";
import { useWide } from "./useWide";
import s from "./Journey.module.css";

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export function Journey() {
  const reduce = useReducedMotion();
  const wide = useWide();
  const mode: Mode = wide ? "row" : "column";
  const L = useMemo(() => layoutOf(mode), [mode]);
  const layout = useRef(L);
  layout.current = L;

  const [lit, setLit] = useState(reduce ? STEPS.length : 0);
  const [playing, setPlaying] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const trail = useRef<SVGLineElement>(null);
  const token = useRef(0);
  const glide = useRef<{ stop: () => void } | null>(null);

  const place = useCallback((p: Pt) => {
    dot.current?.setAttribute("cx", String(p.x));
    dot.current?.setAttribute("cy", String(p.y));
    trail.current?.setAttribute("x2", String(p.x));
    trail.current?.setAttribute("y2", String(p.y));
  }, []);

  const stop = useCallback(() => {
    token.current += 1;
    glide.current?.stop();
    glide.current = null;
  }, []);

  const play = useCallback(async () => {
    stop();
    const mine = token.current;
    const alive = () => token.current === mine;
    const hooks = layout.current.nodes.map((n) => n.hook);
    setPlaying(true);
    setLit(0);
    place(hooks[0]);
    await wait(350);
    for (let i = 0; i < hooks.length; i += 1) {
      if (!alive()) return;
      if (i > 0) {
        const from = hooks[i - 1];
        const to = hooks[i];
        await new Promise<void>((resolve) => {
          glide.current = animate(0, 1, {
            duration: 0.55,
            ease: [0.65, 0, 0.35, 1],
            onUpdate: (t) => place(lerp(from, to, t)),
            onComplete: resolve,
          });
        });
      }
      if (!alive()) return;
      setLit(i + 1);
      if (i < hooks.length - 1) await wait(320);
    }
    if (alive()) setPlaying(false);
  }, [place, stop]);

  // Start once, when the diagram scrolls into view.
  useEffect(() => {
    if (reduce) {
      stop();
      setPlaying(false);
      setLit(STEPS.length);
      return;
    }
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      void play();
      return stop;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void play();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      stop();
    };
  }, [reduce, play, stop]);

  // At rest the dot sits on the last tag the case reached.
  useEffect(() => {
    if (!playing) place(L.nodes[Math.max(0, lit - 1)].hook);
  }, [L, lit, playing, place]);

  const arrow = (m: Pt) =>
    mode === "row"
      ? `M${m.x - 4} ${m.y - 5}L${m.x + 2} ${m.y}L${m.x - 4} ${m.y + 5}`
      : `M${m.x - 5} ${m.y - 4}L${m.x} ${m.y + 2}L${m.x + 5} ${m.y - 4}`;

  return (
    <div ref={box} className={s.wrap}>
      <svg
        className={[s.svg, mode === "column" ? s.column : ""].join(" ")}
        viewBox={`0 0 ${L.width} ${L.height}`}
        aria-hidden="true"
        focusable="false"
      >
        <line className={s.rail} x1={L.rail.from.x} y1={L.rail.from.y} x2={L.rail.to.x} y2={L.rail.to.y} />
        <line ref={trail} className={s.trail} x1={L.rail.from.x} y1={L.rail.from.y} x2={L.rail.from.x} y2={L.rail.from.y} />
        {L.mids.map((m, i) => (
          <path key={i} className={[s.arrow, lit > i + 1 ? s.arrowLit : ""].join(" ")} d={arrow(m)} />
        ))}
        {L.nodes.map((node, i) => (
          <JourneyNode key={STEPS[i].id} node={node} step={STEPS[i]} index={i} lit={lit > i} mode={mode} string={L.string} />
        ))}
        <circle ref={dot} className={s.dot} r="7" cx={L.rail.from.x} cy={L.rail.from.y} />
      </svg>
      <ol className="visually-hidden">
        {STEPS.map((st, i) => (
          <li key={st.id}>
            Step {i + 1}, {st.name}. {st.what} Who: {st.who}
          </li>
        ))}
      </ol>
      <div className={s.foot}>
        <p className={s.caption}>
          The dot is one case moving through the seven steps. Each tag takes its colour when the case reaches it: yellow while a cause is
          being tested, blue for the measurement Crux asks for, green once the repair is checked.
        </p>
        {!reduce && (
          <Button kind="quiet" onClick={() => void play()} disabled={playing}>
            <Icon name="refresh" size={16} />
            Replay
          </Button>
        )}
      </div>
    </div>
  );
}
