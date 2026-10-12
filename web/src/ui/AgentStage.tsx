// The agents at work, drawn as it happens: which agent holds the case, which
// tool it calls, where the call goes and what comes back. Every packet on the
// drawing is one recorded tool call; nothing moves that the run did not do.
//
// Violet is a model's call. Blue is the engine's answer.

import { Bot, CornerDownRight, Pause, Play as PlayIcon, RotateCcw, Search, SkipBack, SkipForward } from "lucide-react";
import type { AgentAbout, AgentStep } from "../api/types";
import type { Play } from "../lib/playback";
import { plainSentence } from "../lib/plain";
import { ON_LIST } from "../lib/scenarios";
import { Button, cx } from "./kit";

type Pt = [number, number];
type Leg = [Pt, Pt, Pt];
type NodeId = "investigator" | "critic" | "gate" | "engine" | "memory" | "docs" | "instrument";

const LEG: Record<string, Leg> = {
  invEngine: [[208, 100], [262, 150], [270, 154]],
  criEngine: [[552, 100], [498, 150], [490, 154]],
  invMemory: [[150, 120], [170, 262], [305, 262]],
  criMemory: [[610, 120], [590, 262], [455, 262]],
  criDocs: [[650, 120], [650, 180], [650, 237]],
  invDocs: [[190, 120], [420, 220], [575, 250]],
  engineInstrument: [[290, 196], [200, 214], [150, 237]],
  invGate: [[170, 64], [240, 34], [305, 40]],
  gateCri: [[455, 40], [520, 34], [590, 64]],
};

const back = (l: Leg): Leg => [l[2], l[1], l[0]];
const pathOf = ([a, c, b]: Leg) => `M${a[0]} ${a[1]} Q${c[0]} ${c[1]} ${b[0]} ${b[1]}`;
const along = ([a, c, b]: Leg, t: number): Pt => {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
};
/** A point a fraction `p` of the way along several legs, end to end. */
function travel(legs: Leg[], p: number): Pt {
  const x = Math.min(0.9999, Math.max(0, p)) * legs.length;
  return along(legs[Math.floor(x)], x - Math.floor(x));
}

function route(step: AgentStep): { legs: Leg[]; target: NodeId } {
  const inv = step.agent !== "critic";
  if (step.tool === "search_knowledge") return { legs: [inv ? LEG.invDocs : LEG.criDocs], target: "docs" };
  if (step.tool === "recall_cases") return { legs: [inv ? LEG.invMemory : LEG.criMemory], target: "memory" };
  if (step.tool === "request_measurement") return { legs: [inv ? LEG.invEngine : LEG.criEngine, LEG.engineInstrument], target: "instrument" };
  return { legs: [inv ? LEG.invEngine : LEG.criEngine], target: "engine" };
}

const AGENT_NAME: Record<string, string> = { investigator: "Investigator", critic: "Critic" };

export function AgentStage({
  about,
  steps,
  play,
  streaming,
  experiments,
  compact,
  controls,
}: {
  about: AgentAbout | null;
  /** The steps to show, in order. */
  steps: AgentStep[];
  play: Play;
  /** More steps may still arrive. */
  streaming: boolean;
  /** How many suspects a round of virtual experiments simulates. */
  experiments?: number;
  compact?: boolean;
  controls?: { start: () => void; pause: () => void; restart: () => void; seek: (i: number) => void };
}) {
  const step = play.at >= 0 ? steps[play.at] : undefined;
  const prev = play.at > 0 ? steps[play.at - 1] : undefined;
  const actor: NodeId = play.beat === "handoff" ? "gate" : ((step?.agent as NodeId | undefined) ?? "investigator");
  const waiting = streaming && (!step || ((play.beat === "rest" || play.beat === "wait") && play.p >= 1 && play.at >= steps.length - 1));
  const r = step ? route(step) : null;

  let packet: { at: Pt; tone: "ask" | "answer" } | null = null;
  let trail: Leg[] = [];
  let target: NodeId | null = null;
  if (step && r) {
    if (play.beat === "handoff" && prev) {
      trail = step.agent === "critic" ? [LEG.invGate, LEG.gateCri] : [back(LEG.gateCri), back(LEG.invGate)];
      packet = { at: travel(trail, play.p), tone: "ask" };
    } else if (play.beat === "ask" || play.beat === "wait") {
      trail = r.legs;
      packet = { at: travel(trail, play.p), tone: "ask" };
      if (play.p > 0.8) target = r.target;
    } else if (play.beat === "answer") {
      trail = r.legs.map(back).reverse();
      packet = { at: travel(trail, play.p), tone: "answer" };
      if (play.p < 0.35) target = r.target;
    }
  }
  const hot = (id: NodeId) => actor === id || target === id;
  // One dot for each suspect a round of experiments simulates: the engine's own list unless the case says otherwise.
  const sims = experiments && experiments > 0 ? experiments : ON_LIST.length;
  const burst = step?.tool === "run_virtual_experiments" && (play.beat === "answer" || (play.beat === "ask" && play.p > 0.7) || play.beat === "wait");
  const answered = step && step.kind !== "says" && step.answered && (play.beat === "answer" || play.beat === "rest");
  const used = (agent: string, tool: string) => steps.slice(0, Math.max(0, play.at)).some((s) => s.agent === agent && s.tool === tool);

  return (
    <div className={cx("stage", compact && "compact")}>
      <svg viewBox="0 0 760 292" role="img" aria-label="The agents, the tools they call and the engine that answers">
        {Object.entries(LEG)
          .filter(([id]) => id !== "invDocs")
          .map(([id, leg]) => (
            <path key={id} d={pathOf(leg)} className="stage-edge" />
          ))}
        <path d="M380 56 V132" className="stage-edge dashed" />
        {trail.map((leg, i) => (
          <path key={i} d={pathOf(leg)} className={cx("stage-edge", "on", packet?.tone)} />
        ))}

        <g className={cx("stage-node", "gate", hot("gate") && "hot")}>
          <rect x={305} y={25} width={150} height={30} rx={15} />
          <text x={380} y={compact ? 46 : 44}>{compact ? "Gate" : "Gate · rules in code"}</text>
        </g>

        <g className={cx("stage-node", "agent", "investigator", hot("investigator") && "hot", waiting && actor === "investigator" && "thinking")}>
          <rect x={40} y={64} width={168} height={56} rx={10} />
          <text x={124} y={compact ? 99 : 88} className="title">
            Investigator
          </text>
          <text x={124} y={106} className="sub">
            reads, measures, closes
          </text>
        </g>

        <g className={cx("stage-node", "agent", "critic", hot("critic") && "hot", waiting && actor === "critic" && "thinking")}>
          <rect x={552} y={64} width={168} height={56} rx={10} />
          <text x={636} y={compact ? 99 : 88} className="title">
            Critic
          </text>
          <text x={636} y={106} className="sub">
            may write one suspect
          </text>
        </g>

        <g className={cx("stage-node", "engine", hot("engine") && "hot")}>
          <rect x={270} y={134} width={220} height={68} rx={12} />
          <text x={380} y={compact ? 175 : 162} className="title">
            Physics engine
          </text>
          <text x={380} y={182} className="sub">
            simulates · scores · decides
          </text>
        </g>
        {burst &&
          Array.from({ length: sims }, (_, i) => {
            const a = (i / sims) * Math.PI * 2 + play.p * 2.4;
            return <circle key={i} cx={380 + 128 * Math.cos(a)} cy={168 + 46 * Math.sin(a)} r={4} className="stage-sim" opacity={0.35 + 0.65 * Math.abs(Math.sin(a * 1.5 + i))} />;
          })}

        <g className={cx("stage-node", "side", hot("instrument") && "hot")}>
          <rect x={35} y={237} width={150} height={30} rx={15} />
          <text x={110} y={compact ? 258 : 256}>{compact ? "Instrument" : "The pump's instrument"}</text>
        </g>
        <g className={cx("stage-node", "side", hot("memory") && "hot")}>
          <rect x={305} y={247} width={150} height={30} rx={15} />
          <text x={380} y={compact ? 268 : 266}>Earlier cases</text>
        </g>
        <g className={cx("stage-node", "side", hot("docs") && "hot")}>
          <rect x={575} y={237} width={150} height={30} rx={15} />
          <text x={650} y={compact ? 258 : 256}>{compact ? "Documents" : "The machine's documents"}</text>
        </g>

        {packet && (
          <g className={cx("stage-packet", packet.tone)} transform={`translate(${packet.at[0]} ${packet.at[1]})`}>
            <circle r={11} className="halo" />
            <circle r={5} />
          </g>
        )}
      </svg>

      <div className="stage-cap" aria-live="polite">
        {!step ? (
          <span className="dim">{streaming ? "The case is open. Waiting for the first call…" : "Press play to watch the run."}</span>
        ) : play.beat === "handoff" ? (
          <span>
            <b>The gate</b> hands the case to the <b className={step.agent === "critic" ? "t-model" : "t-accent"}>{AGENT_NAME[step.agent]?.toLowerCase()}</b>
            {step.agent === "critic" && <span className="dim"> · something in the capture is explained by no suspect</span>}
          </span>
        ) : (
          <>
            <div className="row gap-1 row-wrap">
              <span className={cx("stage-who", step.agent)}>
                {step.agent === "critic" ? <Search size={12} /> : <Bot size={12} />}
                {AGENT_NAME[step.agent] ?? step.agent}
              </span>
              <code>{step.tool}</code>
              {step.kind === "says" && <span className="dim small">narration, never evidence</span>}
              {waiting && <span className="dim small">· waiting for the model…</span>}
            </div>
            {!compact && <div className={step.kind === "says" ? "stage-said" : "stage-asked"}>{plainSentence(step.asked)}</div>}
            {answered && (
              <div className="stage-answer">
                <CornerDownRight size={13} aria-hidden />
                <span>{plainSentence(step.answered ?? "")}</span>
              </div>
            )}
          </>
        )}
      </div>

      {!compact && about && (
        <div className="stage-tools">
          {about.agents.map((a) => (
            <div key={a.name} className="stage-toolrow">
              <span className={cx("stage-who", a.name)}>{AGENT_NAME[a.name] ?? a.name}</span>
              {a.tools.map((t) => (
                <span key={t} className={cx("tool", step?.agent === a.name && step.tool === t && play.beat !== "handoff" ? "now" : used(a.name, t) && "used")}>
                  {t}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}

      {!compact && controls && (
        <div className="stage-bar">
          <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={controls.restart} aria-label="Play the run from the start" />
          <Button size="sm" variant="ghost" icon={<SkipBack size={13} />} onClick={() => controls.seek(play.at - 1)} disabled={play.at <= 0} aria-label="Previous call" />
          <Button size="sm" icon={play.playing ? <Pause size={13} /> : <PlayIcon size={13} />} onClick={play.playing ? controls.pause : play.ended ? controls.restart : controls.start}>
            {play.playing ? "Pause" : play.ended ? "Replay" : "Play"}
          </Button>
          <Button size="sm" variant="ghost" icon={<SkipForward size={13} />} onClick={() => controls.seek(play.at + 1)} disabled={play.at >= steps.length - 1} aria-label="Next call" />
          <input type="range" min={0} max={Math.max(0, steps.length - 1)} value={Math.max(0, play.at)} onChange={(e) => controls.seek(Number(e.target.value))} aria-label="Step through the run" />
          <span className="num dim small nowrap">
            call {Math.max(0, play.at + 1)} of {steps.length}
            {streaming && "+"}
          </span>
        </div>
      )}
    </div>
  );
}
