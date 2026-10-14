// A live question drawn as it runs: which steps exist, who does each (Google's
// data agent, BigQuery, or the question's author), how they connect, and what
// each step said when the server reported it. Every line a node shows comes
// from a step the server streamed (`/series/ask/live`); before a run, a node
// shows what it will do.

import type { Answer, AskStep } from "../../api/series.types";

export type NodeId = "question" | "store" | "tables" | "sql" | "query" | "answer" | "chart" | "engine";
export type Kind = "input" | "store" | "code" | "model" | "engine";
export type Status = "idle" | "running" | "done" | "off" | "failed";

export type NodeDef = { id: NodeId; name: string; kind: Kind; who: string; plan: string; x: number; y: number };
export type NodeRun = { status: Status; started?: number; ended?: number; line?: string };
export type Edge = { id: string; from: NodeId; to: NodeId; d: string; never?: boolean };

/** The drawing's coordinate space: nodes are NODE_W × NODE_H boxes placed in it. */
export const SPACE = { w: 1145, h: 256 };
export const NODE_W = 150;
export const NODE_H = 88;

const TOP = 20;
const LOW = 160;

export const NODES: NodeDef[] = [
  { id: "question", name: "Your question", kind: "input", who: "you", plan: "", x: 10, y: TOP },
  { id: "store", name: "Sensor history", kind: "store", who: "BigQuery", plan: "compressor by the hour and quarter hour, bearing health", x: 205, y: LOW },
  { id: "tables", name: "Reads the tables", kind: "model", who: "Gemini data agent", plan: "what each table holds", x: 205, y: TOP },
  { id: "sql", name: "Writes SQL", kind: "model", who: "Gemini data agent", plan: "one read-only query", x: 400, y: TOP },
  { id: "query", name: "Runs it", kind: "code", who: "BigQuery", plan: "capped at 100 MB a query", x: 595, y: TOP },
  { id: "answer", name: "Answers", kind: "model", who: "Gemini data agent", plan: "what the rows show, in plain words", x: 790, y: TOP },
  { id: "chart", name: "Draws it", kind: "model", who: "Gemini data agent", plan: "a chart when the rows make one", x: 790, y: LOW },
  { id: "engine", name: "Diagnosis", kind: "engine", who: "the engine", plan: "only measured evidence moves it", x: 985, y: TOP },
];

const at = (id: NodeId) => NODES.find((n) => n.id === id)!;
type Pt = [number, number];
const right = (id: NodeId): Pt => [at(id).x + NODE_W, at(id).y + NODE_H / 2];
const left = (id: NodeId): Pt => [at(id).x, at(id).y + NODE_H / 2];
const bottomAt = (id: NodeId, f: number): Pt => [at(id).x + NODE_W * f, at(id).y + NODE_H];
const topAt = (id: NodeId, f: number): Pt => [at(id).x + NODE_W * f, at(id).y];
const across = ([ax, ay]: Pt, [bx, by]: Pt) => {
  const mx = (ax + bx) / 2;
  return `M${ax} ${ay} C${mx} ${ay} ${mx} ${by} ${bx} ${by}`;
};
/** Leaves sideways, arrives from below. */
const up = ([ax, ay]: Pt, [bx, by]: Pt) => `M${ax} ${ay} C${bx} ${ay} ${bx} ${ay} ${bx} ${by}`;
/** Leaves downward, arrives sideways. */
const down = ([ax, ay]: Pt, [bx, by]: Pt) => `M${ax} ${ay} C${ax} ${by} ${ax} ${by} ${bx} ${by}`;

export const EDGES: Edge[] = [
  { id: "question-tables", from: "question", to: "tables", d: across(right("question"), left("tables")) },
  { id: "store-tables", from: "store", to: "tables", d: `M${topAt("store", 0.5).join(" ")} L${bottomAt("tables", 0.5).join(" ")}` },
  { id: "tables-sql", from: "tables", to: "sql", d: across(right("tables"), left("sql")) },
  { id: "sql-query", from: "sql", to: "query", d: across(right("sql"), left("query")) },
  { id: "store-query", from: "store", to: "query", d: up(right("store"), bottomAt("query", 0.3)) },
  { id: "query-answer", from: "query", to: "answer", d: across(right("query"), left("answer")) },
  { id: "query-chart", from: "query", to: "chart", d: down(bottomAt("query", 0.7), left("chart")) },
  { id: "answer-engine", from: "answer", to: "engine", d: across(right("answer"), left("engine")), never: true },
];

export type Runs = Record<NodeId, NodeRun>;

/** Before a run: the history is there already; the diagnosis is never reached. */
export const fresh = (): Runs =>
  Object.fromEntries(
    NODES.map((n) => [n.id, { status: n.id === "store" ? "done" : n.id === "engine" ? "off" : "idle", line: n.id === "store" ? "dataset crux_ts" : undefined }]),
  ) as Runs;

type D = Record<string, unknown>;

/** "Query returned 8 rows in 2.75s." as a node says it. */
function rowsLine(d: D): string {
  const m = /(\d+)\s+rows?\s+in\s+([\d.]+)\s*s/i.exec(String(d.note ?? ""));
  if (m) return `${m[1]} rows in ${m[2]} s`;
  return typeof d.rows === "number" ? `${d.rows} rows` : "done";
}

const mb = (b: unknown) => (typeof b === "number" ? `${(b / 1e6).toFixed(1)} MB billed` : "");

/** What a node says for one streamed step. */
function said(step: Exclude<AskStep, { step: "result" | "error" }>, was: NodeRun): Partial<NodeRun> {
  const d = step.detail as D;
  const start = step.state === "start";
  switch (step.step) {
    case "tables":
      return { line: String(d.note ?? (start ? "reading the tables" : "read")) };
    case "sql":
      return { line: start ? "writing the query" : typeof d.lines === "number" ? `${d.lines} lines of SQL` : "written" };
    case "query":
      return { line: start ? "running in BigQuery" : rowsLine(d) };
    case "answer":
      return { line: start ? "writing what the rows show" : "written" };
    case "chart":
      return { line: start ? "drawing the rows" : "drawn" };
    case "cost":
      return { line: [was.line, mb(d.billed_bytes)].filter(Boolean).join(" · ") };
    default:
      return {};
  }
}

const NODE_OF: Partial<Record<AskStep["step"], NodeId>> = { tables: "tables", sql: "sql", query: "query", answer: "answer", chart: "chart", cost: "query" };

/** The first sentence of an answer, plainly, for its node. */
function firstLine(a: Answer): string {
  const plain = a.answer.replace(/[*`#]/g, "").replace(/\s+/g, " ").trim();
  const cut = plain.search(/[.!?](\s|$)/);
  return cut > 0 ? plain.slice(0, cut + 1) : plain;
}

/** The node states after one more streamed step, stamped with the time it arrived. */
export function advance(runs: Runs, step: AskStep, now: number): Runs {
  if (step.step === "error") {
    const next = { ...runs };
    for (const id of Object.keys(next) as NodeId[]) {
      if (next[id].status === "running") next[id] = { ...next[id], status: "failed", ended: now, line: step.detail.message ?? "failed" };
    }
    return next;
  }
  if (step.step === "result") {
    const next = { ...runs };
    for (const n of NODES) {
      const r = next[n.id];
      if (r.status === "running") next[n.id] = { ...r, status: "done", ended: now };
      else if (r.status === "idle") next[n.id] = { status: "off", line: n.id === "chart" ? "no chart for these rows" : "not needed" };
    }
    next.answer = { ...next.answer, line: firstLine(step.answer) };
    return next;
  }
  if (step.step === "note") {
    // A progress note Google worded differently: it speaks for whichever step is working.
    const id = (Object.keys(runs) as NodeId[]).find((k) => runs[k].status === "running");
    return id ? { ...runs, [id]: { ...runs[id], line: String(step.detail.title ?? runs[id].line) } } : runs;
  }
  const id = NODE_OF[step.step];
  if (!id) return runs;
  const was = runs[id];
  if (step.step === "cost") return { ...runs, [id]: { ...was, ...said(step, was) } };
  const status: Status = step.state === "start" ? "running" : "done";
  const next: NodeRun = { ...was, ...said(step, was), status };
  if (status === "running") next.started = now;
  else {
    next.started = was.started ?? now;
    next.ended = now;
  }
  return { ...runs, [id]: next };
}
