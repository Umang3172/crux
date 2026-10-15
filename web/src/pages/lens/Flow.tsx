// The Lens pipeline drawn as it runs: each box is a step the server reported,
// lit while it works and holding what it found, and a packet runs down every
// arrow when the step before it finishes. Violet is a model's work, blue is
// code and physics, amber waits for a person. The arrow into the diagnosis
// from the second look is barred: a camera finding never moves a belief.

import { useEffect, useRef, useState } from "react";
import { Ban, Camera, Cpu, Eye, FileCheck2, Gauge, Lock, ScanSearch, Sparkles, Waves } from "lucide-react";
import { useReducedMotion } from "../../lib/hooks";
import { EDGES, NODES, NODE_H, NODE_W, SPACE, type NodeId, type Runs } from "./pipeline";

const ICON: Record<NodeId, typeof Camera> = {
  clip: Camera,
  read: Cpu,
  identify: Sparkles,
  gate: Gauge,
  motion: ScanSearch,
  look: Eye,
  sound: Waves,
  confirm: Eye,
  engine: Lock,
  report: FileCheck2,
};

const pct = (v: number, of: number) => `${(v / of) * 100}%`;
const PACKET_S = 0.75;

type Packet = { edge: string; t0: number };

function seconds(run: Runs[NodeId], now: number) {
  if (!run.started) return "";
  const end = run.ended ?? now;
  return `${Math.max(0, (end - run.started) / 1000).toFixed(1)} s`;
}

export function Flow({ runs, label }: { runs: Runs; label: string }) {
  const reduced = useReducedMotion();
  const svg = useRef<SVGSVGElement>(null);
  const packets = useRef<Packet[]>([]);
  const frame = useRef(0);
  const seen = useRef<Partial<Record<NodeId, string>>>({});
  const [now, setNow] = useState(() => performance.now());
  const running = Object.values(runs).some((r) => r.status === "running");

  // The clock that the running boxes count on.
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(t);
  }, [running]);

  // A packet down each arrow out of a step the moment it finishes.
  useEffect(() => {
    const t = performance.now();
    for (const node of NODES) {
      const status = runs[node.id].status;
      const before = seen.current[node.id];
      seen.current[node.id] = status;
      if (status === before || !(status === "done" || status === "waiting")) continue;
      for (const e of EDGES) if (e.from === node.id && !e.never && !e.later) packets.current.push({ edge: e.id, t0: t });
    }
    if (reduced || !packets.current.length) {
      packets.current = [];
      return;
    }
    const tick = () => {
      const s = svg.current;
      if (!s) return;
      const nowMs = performance.now();
      packets.current = packets.current.filter((p) => nowMs - p.t0 < PACKET_S * 1000);
      const layer = s.querySelector<SVGGElement>("g[data-packets]");
      if (layer) {
        layer.innerHTML = packets.current
          .map((p) => {
            const path = s.querySelector<SVGPathElement>(`path[data-edge="${p.edge}"]`);
            if (!path) return "";
            const f = (nowMs - p.t0) / (PACKET_S * 1000);
            const eased = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
            const pt = path.getPointAtLength(path.getTotalLength() * eased);
            const kind = path.dataset.kind ?? "code";
            return `<circle class="lf-packet" data-kind="${kind}" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="4.2"/>`;
          })
          .join("");
      }
      frame.current = packets.current.length ? requestAnimationFrame(tick) : 0;
    };
    if (!frame.current) frame.current = requestAnimationFrame(tick);
  }, [runs, reduced]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const kindOf = (id: NodeId) => NODES.find((n) => n.id === id)!.kind;
  const edgeState = (from: NodeId, to: NodeId) => {
    const a = runs[from].status;
    const b = runs[to].status;
    if (b === "running" && (a === "done" || a === "waiting")) return "live";
    if (a === "done" || a === "waiting") return b === "idle" ? "ready" : "done";
    return "idle";
  };

  return (
    <div className="lf" role="group" aria-label={label}>
      <div className="lf-stage" style={{ aspectRatio: `${SPACE.w} / ${SPACE.h}` }}>
        <svg ref={svg} className="lf-edges" viewBox={`0 0 ${SPACE.w} ${SPACE.h}`} aria-hidden>
          <defs>
            <marker id="lf-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L8 4 L0 8 z" className="lf-arrowhead" />
            </marker>
          </defs>
          {EDGES.map((e) => {
            const state = e.never ? "never" : e.later ? "later" : edgeState(e.from, e.to);
            return (
              <path
                key={e.id}
                d={e.d}
                data-edge={e.id}
                data-kind={kindOf(e.to)}
                data-state={state}
                className="lf-edge"
                markerEnd={e.never ? undefined : "url(#lf-arrow)"}
              />
            );
          })}
          <g data-packets />
        </svg>
        {EDGES.filter((e) => e.never).map((e) => {
          const a = NODES.find((n) => n.id === e.from)!;
          return (
            <span key={e.id} className="lf-bar" style={{ left: pct(a.x + NODE_W / 2, SPACE.w), top: pct(a.y + NODE_H + (304 - a.y - NODE_H) / 2, SPACE.h) }} title="A camera finding never moves a diagnosis">
              <Ban size={13} aria-hidden />
            </span>
          );
        })}
        <ol className="lf-nodes">
          {NODES.map((node) => {
            const run = runs[node.id];
            const Icon = ICON[node.id];
            const time = node.kind === "engine" ? "" : seconds(run, now);
            return (
              <li
                key={node.id}
                className="lf-node"
                data-kind={node.kind}
                data-status={run.status}
                style={{ left: pct(node.x, SPACE.w), top: pct(node.y, SPACE.h), width: pct(NODE_W, SPACE.w), height: pct(NODE_H, SPACE.h) }}
              >
                <div className="lf-head">
                  <Icon size={13} aria-hidden />
                  <b>{node.name}</b>
                </div>
                <div className="lf-who">
                  <span>{run.who ?? node.who}</span>
                  {time && <span className="lf-time">{time}</span>}
                </div>
                <div className="lf-line">{run.line ?? node.plan}</div>
                <span className="sr-only">
                  {run.status === "running" ? "working" : run.status === "done" ? "done" : run.status === "waiting" ? "waiting for a person" : run.status}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="lf-legend small dim">
        <span>
          <i data-kind="model" /> a model looks
        </span>
        <span>
          <i data-kind="code" /> code and physics
        </span>
        <span>
          <i data-kind="person" /> waits for a person
        </span>
        <span>
          <Ban size={11} aria-hidden /> a camera finding never reaches the diagnosis
        </span>
      </div>
    </div>
  );
}
