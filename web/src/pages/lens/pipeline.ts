// The Lens pipeline as a page draws it: which steps exist, who does each (a
// model, plain code, or a person), how they connect, and what each step said
// when the server reported it. Every line a node shows comes from a step the
// server streamed; before a run, a node shows what it will do.

import type { ScanStep } from "../../api/types";

export type NodeId = "clip" | "read" | "identify" | "gate" | "motion" | "look" | "sound" | "confirm" | "engine" | "report";
export type Kind = "phone" | "code" | "model" | "person" | "engine";
export type Status = "idle" | "running" | "done" | "off" | "waiting" | "failed";

export type NodeDef = { id: NodeId; name: string; kind: Kind; who: string; plan: string; x: number; y: number };
export type NodeRun = { status: Status; started?: number; ended?: number; line?: string; who?: string };
export type Edge = { id: string; from: NodeId; to: NodeId; d: string; never?: boolean; later?: boolean };

/** The drawing's coordinate space: nodes are NODE_W × NODE_H boxes placed in it. */
export const SPACE = { w: 1035, h: 420 };
export const NODE_W = 140;
export const NODE_H = 92;

export const NODES: NodeDef[] = [
  { id: "clip", name: "Phone clip", kind: "phone", who: "the technician", plan: "about ten seconds of the machine", x: 10, y: 164 },
  { id: "read", name: "Read video", kind: "code", who: "code", plan: "frames, true frame rate, sound, three stills", x: 185, y: 164 },
  { id: "identify", name: "Name it", kind: "model", who: "vision model", plan: "what it is; a nameplate only if read twice", x: 360, y: 24 },
  { id: "gate", name: "Photo gate", kind: "code", who: "code", plan: "too dark, blown out, too small: no model sees it", x: 360, y: 164 },
  { id: "motion", name: "Track motion", kind: "code", who: "physics", plan: "how the housing shakes, hand shake removed", x: 360, y: 304 },
  { id: "look", name: "Checklist look", kind: "model", who: "vision model", plan: "crack, leak, rust, belt, heat, loose, smoke, with boxes", x: 535, y: 164 },
  { id: "sound", name: "Listen", kind: "code", who: "physics", plan: "the sound against each fault, at a confirmed speed", x: 535, y: 304 },
  { id: "confirm", name: "Second look", kind: "model", who: "vision model", plan: "each finding asked again, fresh, on a crop", x: 710, y: 164 },
  { id: "engine", name: "Diagnosis", kind: "engine", who: "the engine", plan: "only measured evidence moves it", x: 710, y: 304 },
  { id: "report", name: "Scan saved", kind: "code", who: "code", plan: "what was seen, marked unconfirmed", x: 885, y: 164 },
];

const at = (id: NodeId) => NODES.find((n) => n.id === id)!;
const right = (id: NodeId): [number, number] => [at(id).x + NODE_W, at(id).y + NODE_H / 2];
const left = (id: NodeId): [number, number] => [at(id).x, at(id).y + NODE_H / 2];
const top = (id: NodeId): [number, number] => [at(id).x + NODE_W / 2, at(id).y];
const bottom = (id: NodeId): [number, number] => [at(id).x + NODE_W / 2, at(id).y + NODE_H];
const curve = ([ax, ay]: [number, number], [bx, by]: [number, number]) => {
  const mx = (ax + bx) / 2;
  return `M${ax} ${ay} C${mx} ${ay} ${mx} ${by} ${bx} ${by}`;
};

export const EDGES: Edge[] = [
  { id: "clip-read", from: "clip", to: "read", d: curve(right("clip"), left("read")) },
  { id: "read-identify", from: "read", to: "identify", d: curve(right("read"), left("identify")) },
  { id: "read-gate", from: "read", to: "gate", d: curve(right("read"), left("gate")) },
  { id: "read-motion", from: "read", to: "motion", d: curve(right("read"), left("motion")) },
  { id: "identify-look", from: "identify", to: "look", d: curve(right("identify"), [at("look").x + 30, at("look").y]) },
  { id: "gate-look", from: "gate", to: "look", d: curve(right("gate"), left("look")) },
  { id: "look-confirm", from: "look", to: "confirm", d: curve(right("look"), left("confirm")) },
  { id: "confirm-report", from: "confirm", to: "report", d: curve(right("confirm"), left("report")) },
  {
    id: "identify-report",
    from: "identify",
    to: "report",
    d: `M${right("identify")[0]} ${right("identify")[1]} C${top("report")[0]} ${right("identify")[1]} ${top("report")[0]} ${right("identify")[1]} ${top("report")[0]} ${top("report")[1]}`,
  },
  { id: "motion-sound", from: "motion", to: "sound", d: curve(right("motion"), left("sound")) },
  {
    id: "motion-report",
    from: "motion",
    to: "report",
    // Under the bottom row, so it crosses no box.
    d: (() => {
      const [ax, ay] = bottom("motion");
      const [bx, by] = bottom("report");
      const y = SPACE.h - 6;
      return `M${ax} ${ay} L${ax} ${y - 8} Q${ax} ${y} ${ax + 8} ${y} L${bx - 8} ${y} Q${bx} ${y} ${bx} ${y - 8} L${bx} ${by}`;
    })(),
  },
  { id: "sound-engine", from: "sound", to: "engine", d: curve(right("sound"), left("engine")), later: true },
  { id: "confirm-engine", from: "confirm", to: "engine", d: `M${bottom("confirm")[0]} ${bottom("confirm")[1]} L${top("engine")[0]} ${top("engine")[1]}`, never: true },
];

export type Runs = Record<NodeId, NodeRun>;

export const fresh = (): Runs =>
  Object.fromEntries(NODES.map((n) => [n.id, { status: n.id === "engine" ? "off" : "idle" }])) as Runs;

/** A model's id as a person reads it. */
export function modelName(by: unknown): string {
  const s = String(by ?? "");
  if (!s || s === "nobody" || s === "offline") return "no model on";
  const id = s.replace(/^gemini:/, "").replace(/^ollama:/, "");
  const code = id.endsWith("+code");
  const bare = id.replace(/\+code$/, "");
  const pretty = /gemini-3-flash/.test(bare)
    ? "Gemini 3 Flash"
    : /gemini-3\.8-flash/.test(bare)
      ? "Gemini 3.8 Flash"
      : /robotics-er/.test(bare)
        ? "Gemini Robotics-ER"
        : s.startsWith("ollama:")
          ? `${bare} (local)`
          : bare;
  return code ? `${pretty} · runs code` : pretty;
}

type D = Record<string, unknown>;
const n = (v: unknown, digits = 0) => (typeof v === "number" ? v.toFixed(digits) : "–");
const items = (v: unknown) => (Array.isArray(v) ? (v as D[]) : []);
const short = (label: unknown) => String(label ?? "").replace(/\s*\(.*\)$/, "").toLowerCase();

/** What a node says for one streamed step. */
function said(step: ScanStep): Partial<NodeRun> {
  const d = (step.detail ?? {}) as D;
  switch (step.step) {
    case "read":
      return step.state === "start"
        ? { line: `${n(Number(d.bytes) / 1e6, 1)} MB in` }
        : { line: `${d.frames} frames · ${n(d.fps, 0)} fps · ${n(d.duration_s, 1)} s${d.sound ? " · sound" : ""}` };
    case "identify":
      if (step.state === "start") return { line: "asking what this is" };
      if (step.state === "off") return { line: "no model on", who: "off" };
      return { line: d.machine_type ? `“${d.machine_type}”${d.nameplate_text ? " · plate read" : ""}` : "nothing named", who: modelName(d.by) };
    case "gate":
      if (!d.usable) return { line: `turned back: ${d.reason}` };
      return { line: d.soft ? `soft (sharpness ${n(d.sharpness)}): looked at, misses likelier` : `sharp enough (${n(d.sharpness)})` };
    case "look": {
      if (step.state === "start") return { line: `${items(d.items).length || 7}-item checklist on the frame`, who: modelName(d.by) };
      if (step.state !== "done") return { line: String(d.note ?? "not looked at"), who: modelName(d.by) };
      const seen = items(d.present);
      return {
        line: seen.length ? `${seen.length} of ${d.answered ?? 7} seen: ${seen.map((f) => short(f.label)).join(", ")}` : `nothing seen on ${d.answered ?? 7} items`,
        who: modelName(d.by),
      };
    }
    case "confirm": {
      if (step.state === "start") return { line: `asking about ${d.count} again, on crops`, who: modelName(d.by) };
      const kept = items(d.kept);
      if (step.state === "skipped") return { line: kept.length ? "no second look on this model" : "nothing to ask about", who: modelName(d.by) };
      const all = kept.length + Number(d.dropped ?? 0);
      return { line: `${kept.length} of ${all} kept${Number(d.dropped) ? `, ${d.dropped} dropped` : ""}`, who: modelName(d.by) };
    }
    case "motion": {
      if (step.state === "start") return { line: `${d.frames} frames` };
      const lines = items(d.candidates);
      return { line: lines.length ? `lines at ${lines.map((c) => n(c.hz, 1)).join(", ")} Hz · ${n(d.rms_px, 2)} px` : "no steady line stands out" };
    }
    case "sound":
      return { line: d.sound ? "kept: tested once a person confirms the speed" : "no sound track" };
    case "save":
      return { line: `scan ${d.id}` };
    default:
      return {};
  }
}

const NODE_OF: Partial<Record<ScanStep["step"], NodeId>> = {
  read: "read",
  identify: "identify",
  gate: "gate",
  look: "look",
  confirm: "confirm",
  motion: "motion",
  sound: "sound",
  save: "report",
};

const STATUS_OF: Record<ScanStep["state"], Status> = {
  start: "running",
  done: "done",
  off: "off",
  skipped: "off",
  waiting: "waiting",
  failed: "failed",
};

/** The node states after one more streamed step, stamped with the time it arrived. */
export function advance(runs: Runs, step: ScanStep, now: number): Runs {
  if (step.step === "error") {
    const next = { ...runs };
    for (const id of Object.keys(next) as NodeId[]) {
      if (next[id].status === "running") next[id] = { ...next[id], status: "failed", ended: now, line: String(step.detail?.message ?? "failed") };
    }
    return next;
  }
  const id = NODE_OF[step.step];
  if (!id) return runs;
  const was = runs[id];
  const status = STATUS_OF[step.state];
  const next: NodeRun = { ...was, ...said(step), status };
  if (status === "running") next.started = now;
  else {
    next.started = was.started ?? now;
    next.ended = now;
  }
  return { ...runs, [id]: next };
}
