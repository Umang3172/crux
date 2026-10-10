/**
 * "How this works": an animated flow for the tab above it.
 *
 * Plays the tab's steps in order. The boxes in play light up, data runs along
 * the arrows between them, and one plain sentence says what happens. Click any
 * step to stop on it. On a phone the same steps read as a list.
 */

import { useEffect, useMemo, useState } from "react";
import {
  type Diagram,
  type FlowEdge,
  type FlowNode,
  KIND_LABEL,
  type Kind,
  NODE_H,
  NODE_W,
  type Side,
} from "./diagrams";
import "./how.css";

const STEP_MS = 4200;

function remembered(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== "closed";
  } catch {
    return true;
  }
}

function remember(key: string, open: boolean) {
  try {
    window.localStorage.setItem(key, open ? "open" : "closed");
  } catch {
    /* a private window: the panel just opens next time */
  }
}

function prefersStill(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const NORMAL: Record<Side, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  top: [0, -1],
  bottom: [0, 1],
};

function anchor(n: FlowNode, side: Side): [number, number] {
  if (side === "left") return [n.x, n.y + NODE_H / 2];
  if (side === "right") return [n.x + NODE_W, n.y + NODE_H / 2];
  if (side === "top") return [n.x + NODE_W / 2, n.y];
  return [n.x + NODE_W / 2, n.y + NODE_H];
}

function sidesFor(a: FlowNode, b: FlowNode): [Side, Side] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy) * 0.9) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

/** A cubic curve leaving and entering square to each box side; its midpoint for a label. */
function route(a: FlowNode, b: FlowNode, e: FlowEdge) {
  const [sa, sb] = e.sides ?? sidesFor(a, b);
  const p1 = anchor(a, sa);
  const p2 = anchor(b, sb);
  const dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  const k = sa === sb ? 70 : Math.max(28, dist * 0.42);
  const c1: [number, number] = [p1[0] + NORMAL[sa][0] * k, p1[1] + NORMAL[sa][1] * k];
  const c2: [number, number] = [p2[0] + NORMAL[sb][0] * k, p2[1] + NORMAL[sb][1] * k];
  const d = `M${p1[0]},${p1[1]} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  const mid: [number, number] = [
    (p1[0] + 3 * c1[0] + 3 * c2[0] + p2[0]) / 8,
    (p1[1] + 3 * c1[1] + 3 * c2[1] + p2[1]) / 8,
  ];
  return { d, mid };
}

export function HowItWorks({ id, diagram }: { id: string; diagram: Diagram }) {
  const key = `crux.how.${id}`;
  const [open, setOpen] = useState(() => remembered(key));
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(() => !prefersStill());
  const still = useMemo(prefersStill, []);
  const n = diagram.steps.length;

  useEffect(() => {
    setStep(0);
    setPlaying(!still);
  }, [diagram, still]);

  useEffect(() => {
    if (!open || !playing) return;
    const t = window.setTimeout(() => setStep((s) => (s + 1) % n), STEP_MS);
    return () => window.clearTimeout(t);
  }, [open, playing, step, n]);

  const toggle = () => {
    remember(key, !open);
    setOpen(!open);
  };

  const byId = useMemo(() => new Map(diagram.nodes.map((x) => [x.id, x])), [diagram]);
  const current = diagram.steps[step];
  const active = new Set(current.nodes);
  const seen = new Set(diagram.steps.slice(0, step).flatMap((s) => s.nodes));
  const flowing = new Set(current.edges ?? []);
  const kinds = [...new Set(diagram.nodes.map((x) => x.kind))] as Kind[];

  return (
    <section className={`hw${open ? " open" : ""}`} aria-label={`How it works: ${diagram.title}`}>
      <div className="hw-head">
        <div>
          <p className="hw-kicker">How this works</p>
          {open && <h2>{diagram.title}</h2>}
          {open && <p className="hw-lede">{diagram.lede}</p>}
        </div>
        <button className="hw-toggle" onClick={toggle} aria-expanded={open}>
          {open ? "Hide" : "Show the diagram"}
        </button>
      </div>

      {open && (
        <>
          <svg
            className="hw-svg"
            viewBox={`0 0 ${diagram.width} ${diagram.height}`}
            role="img"
            aria-label={`${diagram.title}. Step ${step + 1}: ${current.title}`}
          >
            <defs>
              <marker
                id={`hw-arrow-${id}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" className="hw-arrowhead" />
              </marker>
              <marker
                id={`hw-arrow-on-${id}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" className="hw-arrowhead on" />
              </marker>
            </defs>

            {diagram.edges.map((e) => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              const { d, mid } = route(a, b, e);
              const on = flowing.has(`${e.from}>${e.to}`);
              return (
                <g
                  key={`${e.from}>${e.to}`}
                  className={`hw-edge${on ? " on" : ""}${e.dashed ? " dashed" : ""}`}
                >
                  <path d={d} markerEnd={`url(#hw-arrow${on ? "-on" : ""}-${id})`} />
                  {on && !still && (
                    <circle r="5" className="hw-pulse" key={`${step}-${e.from}-${e.to}`}>
                      <animateMotion dur="1.4s" repeatCount="indefinite" path={d} />
                    </circle>
                  )}
                  {e.label && (
                    <text x={mid[0]} y={mid[1] - 6} textAnchor="middle" className="hw-edge-label">
                      {e.label}
                    </text>
                  )}
                </g>
              );
            })}

            {diagram.nodes.map((x) => {
              const state = active.has(x.id) ? "active" : seen.has(x.id) ? "seen" : "later";
              return (
                <g key={x.id} className={`hw-node k-${x.kind} ${state}`}>
                  <rect x={x.x} y={x.y} width={NODE_W} height={NODE_H} rx="12" />
                  <foreignObject x={x.x} y={x.y} width={NODE_W} height={NODE_H}>
                    <div className="hw-node-text">
                      <strong>{x.label}</strong>
                      <span>{x.sub}</span>
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </svg>

          <ol className="hw-list" aria-label="Steps">
            {diagram.steps.map((s, i) => (
              <li key={s.title} className={i === step ? "on" : i < step ? "done" : ""}>
                <button onClick={() => (setStep(i), setPlaying(false))}>
                  <span className="hw-num">{i + 1}</span>
                  <span className="hw-step-title">{s.title}</span>
                </button>
                {i === step && <p className="hw-step-text">{s.text}</p>}
              </li>
            ))}
          </ol>

          <div className="hw-caption" aria-live="polite">
            <p className="hw-caption-title">
              <span className="hw-num">{step + 1}</span> {current.title}
            </p>
            <p className="hw-caption-text">{current.text}</p>
          </div>

          <div className="hw-controls">
            <button
              onClick={() => (setStep((step - 1 + n) % n), setPlaying(false))}
              aria-label="Previous step"
            >
              ‹
            </button>
            <button onClick={() => setPlaying(!playing)} className="hw-play">
              {playing ? "Pause" : "Play"}
            </button>
            <button
              onClick={() => (setStep((step + 1) % n), setPlaying(false))}
              aria-label="Next step"
            >
              ›
            </button>
            <div className="hw-dots" role="tablist" aria-label="Steps">
              {diagram.steps.map((s, i) => (
                <button
                  key={s.title}
                  role="tab"
                  aria-selected={i === step}
                  aria-label={`Step ${i + 1}: ${s.title}`}
                  className={i === step ? "on" : ""}
                  onClick={() => (setStep(i), setPlaying(false))}
                />
              ))}
            </div>
            <ul className="hw-legend" aria-label="Key">
              {kinds.map((k) => (
                <li key={k}>
                  <span className={`hw-swatch k-${k}`} />
                  {KIND_LABEL[k]}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
