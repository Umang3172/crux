// A live question drawn as it runs: each box is a step the server reported,
// lit while it works and holding what it found, and a packet runs down every
// arrow into a step the moment it starts. Violet is the data agent's work,
// blue is BigQuery and the data. The arrow from the answer to the diagnosis is
// barred: nothing said here ever moves a belief.

import { useEffect, useRef, useState } from "react";
import { Ban, ChartLine, Database, FileText, MessageSquareText, PenLine, ScanSearch, ShieldCheck, Table2, type LucideIcon } from "lucide-react";
import { useReducedMotion } from "../../lib/hooks";
import { EDGES, NODES, NODE_H, NODE_W, SPACE, type NodeId, type Runs } from "./askPipeline";

const ICON: Record<NodeId, LucideIcon> = {
  question: MessageSquareText,
  store: Database,
  tables: Table2,
  sql: PenLine,
  query: ScanSearch,
  answer: FileText,
  chart: ChartLine,
  engine: ShieldCheck,
};

const pct = (v: number, of: number) => `${(v / of) * 100}%`;
const PACKET_S = 0.75;

type Packet = { edge: string; t0: number };

function seconds(run: Runs[NodeId], now: number) {
  if (!run.started) return "";
  const end = run.ended ?? now;
  return `${Math.max(0, (end - run.started) / 1000).toFixed(1)} s`;
}

export function AskFlow({ runs, question, label }: { runs: Runs; question: string | null; label: string }) {
  const reduced = useReducedMotion();
  const svg = useRef<SVGSVGElement>(null);
  const packets = useRef<Packet[]>([]);
  const frame = useRef(0);
  const seen = useRef<Partial<Record<NodeId, string>>>({});
  const [now, setNow] = useState(() => performance.now());
  const running = Object.values(runs).some((r) => r.status === "running");

  // The clock the working boxes count on.
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(t);
  }, [running]);

  // A packet down each arrow into a step the moment that step starts.
  useEffect(() => {
    const t = performance.now();
    for (const node of NODES) {
      const status = runs[node.id].status;
      const before = seen.current[node.id];
      seen.current[node.id] = status;
      if (status === before || !(status === "running" || (status === "done" && before === "idle"))) continue;
      for (const e of EDGES) if (e.to === node.id && !e.never && runs[e.from].status === "done") packets.current.push({ edge: e.id, t0: t });
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
            return `<circle class="tf-packet" data-kind="${path.dataset.kind ?? "code"}" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="4.2"/>`;
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
    if (b === "running" && a === "done") return "live";
    if (a === "done") return b === "idle" || b === "off" ? "ready" : "done";
    return "idle";
  };

  return (
    <div className="tf" role="group" aria-label={label}>
      <div className="tf-stage" style={{ aspectRatio: `${SPACE.w} / ${SPACE.h}` }}>
        <svg ref={svg} className="tf-edges" viewBox={`0 0 ${SPACE.w} ${SPACE.h}`} aria-hidden>
          <defs>
            <marker id="tf-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L8 4 L0 8 z" className="tf-arrowhead" />
            </marker>
          </defs>
          {EDGES.map((e) => (
            <path
              key={e.id}
              d={e.d}
              data-edge={e.id}
              data-kind={kindOf(e.to)}
              data-state={e.never ? "never" : edgeState(e.from, e.to)}
              className="tf-edge"
              markerEnd={e.never ? undefined : "url(#tf-arrow)"}
            />
          ))}
          <g data-packets />
        </svg>
        {EDGES.filter((e) => e.never).map((e) => {
          const a = NODES.find((n) => n.id === e.from)!;
          const b = NODES.find((n) => n.id === e.to)!;
          return (
            <span
              key={e.id}
              className="tf-bar"
              style={{ left: pct((a.x + NODE_W + b.x) / 2, SPACE.w), top: pct(a.y + NODE_H / 2, SPACE.h) }}
              title="An answer here never reaches a diagnosis"
            >
              <Ban size={13} aria-hidden />
            </span>
          );
        })}
        <ol className="tf-nodes">
          {NODES.map((node) => {
            const run = runs[node.id];
            const Icon = ICON[node.id];
            const time = node.kind === "engine" || node.kind === "store" || node.kind === "input" ? "" : seconds(run, now);
            return (
              <li
                key={node.id}
                className="tf-node"
                data-kind={node.kind}
                data-status={run.status}
                style={{ left: pct(node.x, SPACE.w), top: pct(node.y, SPACE.h), width: pct(NODE_W, SPACE.w), height: pct(NODE_H, SPACE.h) }}
              >
                <div className="tf-head">
                  <Icon size={13} aria-hidden />
                  <b>{node.name}</b>
                </div>
                <div className="tf-who">
                  <span>{node.who}</span>
                  {time && <span className="tf-time">{time}</span>}
                </div>
                <div className="tf-line">{node.id === "question" ? (question ? `“${question}”` : "what you ask, in plain words") : (run.line ?? node.plan)}</div>
                <span className="sr-only">{run.status === "running" ? "working" : run.status === "done" ? "done" : run.status}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="tf-legend small dim">
        <span>
          <i data-kind="model" /> Gemini data agent
        </span>
        <span>
          <i data-kind="code" /> BigQuery and the data
        </span>
        <span>
          <Ban size={11} aria-hidden /> an answer here never reaches a diagnosis
        </span>
      </div>
    </div>
  );
}
