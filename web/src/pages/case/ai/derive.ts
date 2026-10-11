// What the AI case view needs from a stored run, worked out in one place.
// Nothing here makes up a number or a sentence: every figure and every line
// comes from the run, the case or the server's report.

import type { AgentRun, AgentStep, CaseView, Report, ReportPart } from "../../../api/types";
import { brainOf, type Brain } from "../../../app/ai";
import { meaningfulSteps } from "../../../lib/case";
import { fault, type Part } from "../../../lib/plain";
import type { RackSuspect } from "../../../ui/SuspectRack";

/** One thing the AI did, in order, with the arguments it called its tool with. */
export type Turn = AgentStep & { n: number; args: Record<string, unknown> };

/**
 * The run's steps and the calls that made them line up one for one. The first
 * read of the case, before any experiment, says nothing true yet and is dropped.
 */
export function turnsOf(run: AgentRun): Turn[] {
  const joined = run.steps.map((step, i) => {
    const call = run.tool_calls[i];
    return { ...step, args: call && call.tool === step.tool ? call.args : {} };
  });
  return meaningfulSteps(joined).map((step, i) => ({ ...step, n: i + 1 }));
}

/** "the offline stand-in", "Gemini": how a brain reads after "written by". */
export const named = (b: Brain): string => (b.name === "Gemini" ? b.name : `the ${b.name}`);

/** Which brain a step ran on. A critic step carries the investigator's model name in `by`. */
export const brainOfTurn = (t: Pick<Turn, "by">): Brain => brainOf(t.by);

/** Who ran this run, as one phrase for the header. */
export function brainLine(run: AgentRun): string {
  const b = brainOf(run.model);
  if (run.fallback) return `${b.name} (stopped part-way), then the offline stand-in`;
  if (b.live) return `${b.name} (${run.model.replace(/^[a-z]+:/i, "")})`;
  return b.name;
}

/** The part of the machine to mark: only once the engine has named a cause. */
export function markedPart(c: CaseView): Part | null {
  if (c.status !== "concluded") return null;
  const part = fault(c.leader).part;
  return part === "none" ? null : part;
}

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** The name the AI gave a suspect it proposed. */
export const proposedName = (t: Turn): string => text(record(t.args.suspect).name);

/** The run as rows: each turn, with a handover wherever the other agent takes the case. */
export type Row = { kind: "turn"; turn: Turn } | { kind: "handover"; agent: Turn["agent"]; first: boolean };

export function rowsOf(turns: Turn[]): Row[] {
  const rows: Row[] = [];
  let prev: Turn["agent"] | null = null;
  for (const turn of turns) {
    if (turn.agent !== prev) {
      rows.push({ kind: "handover", agent: turn.agent, first: prev === null });
      prev = turn.agent;
    }
    rows.push({ kind: "turn", turn });
  }
  return rows;
}

/** A suspect the AI wrote, and what the physics did with it. */
export type Proposal = {
  name: string;
  label: string;
  agent: AgentStep["agent"];
  description: string;
  cites: string[];
  outcome: "kept" | "refused" | "queued";
  /** The physics' own answer to the proposal. */
  said: string;
  belief: number | null;
  ruledOut: boolean;
  source: string | null;
};

export function proposalsOf(turns: Turn[], c: CaseView): Proposal[] {
  return turns
    .filter((t) => t.tool === "propose_suspect")
    .map((t) => {
      const spec = record(t.args.suspect);
      const name = text(spec.name);
      const view = c.suspects.find((x) => x.name === name);
      const said = t.answered ?? "";
      const refused = view?.status === "refused" || /^Refused/i.test(said);
      const queued = !refused && /^Added; it will be simulated/i.test(said);
      return {
        name,
        label: view?.label ?? name.replace(/_/g, " "),
        agent: t.agent,
        description: text(spec.description),
        cites: Array.isArray(spec.cites) ? spec.cites.filter((x): x is string => typeof x === "string") : [],
        outcome: refused ? "refused" : queued ? "queued" : "kept",
        said,
        belief: refused ? null : (view?.belief ?? null),
        ruledOut: view?.status === "rejected",
        source: view?.source ?? null,
      } satisfies Proposal;
    });
}

/** The suspects as tags on the rack. A refused one carries the physics' reason. */
export function rackOf(c: CaseView, proposals: Proposal[]): RackSuspect[] {
  return c.suspects.map((x) => {
    const said = proposals.find((p) => p.name === x.name)?.said ?? "";
    const reason = said.replace(/^Refused\.?\s*/i, "").trim();
    return {
      kind: x.name,
      label: x.label,
      belief: x.status === "refused" || x.status === "untested" ? null : x.belief,
      ruledOut: x.status === "rejected",
      origin: x.origin,
      refused: x.status === "refused" ? reason || "It was refused before it could be tested." : undefined,
      note: x.source ? `From the machine's notes (${x.source.split(":")[0]})` : x.status === "untested" ? "Not tested yet" : undefined,
    } satisfies RackSuspect;
  });
}

/** What stood in the way of a verdict before a suspect was written: the engine's own sentence. */
export function blockerOf(c: CaseView): string | null {
  if (c.blockers.length > 0) return c.blockers.join(" ");
  return c.transcript.find((t) => /no hypothesis on the list predicts/.test(t)) ?? null;
}

/** The sentence the transcript gives for the virtual experiments, without the beliefs that follow it. */
export function experimentsLine(c: CaseView): string | null {
  const line = c.transcript.find((t) => t.startsWith("Virtual experiments:"));
  return line ? line.split(" Belief:")[0] : null;
}

/** The engine's answer to the investigator's request for a verdict, when it gave one. */
export function conclusionOf(turns: Turn[]): Turn | undefined {
  return [...turns].reverse().find((t) => t.tool === "conclude" && !!t.answered && !/^Not yet/i.test(t.answered));
}

/** One line of the server's report, by what it is for. */
export function lineOf(rep: Report | null, part: ReportPart): string | null {
  return rep?.lines.find((l) => l.part === part)?.text ?? null;
}

/** The AI asked for the machine's earlier cases at least once. */
export const askedForMemory = (run: AgentRun): boolean => run.tool_calls.some((t) => t.tool === "recall_cases");

export const sentence = (t: string): string => t.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The step's text after a fixed prefix the server adds to what the model sent. */
export const after = (s: string, prefix: string): string => (s.startsWith(prefix) ? s.slice(prefix.length) : s);
