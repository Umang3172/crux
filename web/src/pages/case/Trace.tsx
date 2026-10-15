// What did the work. For an AI investigation: every tool call, by which
// investigator, and the physics' answer to it. For the engine: its own log.

import { Bot, CornerDownRight, ScrollText, Search, Sparkles } from "lucide-react";
import type { AgentAbout, AgentRun, AgentStep } from "../../api/types";
import { runBrain } from "../../lib/ai";
import { num } from "../../lib/format";
import { isOpeningRead } from "../../lib/liveruns";
import { plainSentence } from "../../lib/plain";
import { ENGINE_MACHINE_NAME } from "../../lib/scenarios";
import { Badge, Card, Hint, cx } from "../../ui/kit";
import { EngineWords } from "./bits";

type Call = AgentStep & { args: Record<string, unknown>; n: number };
type Turn = { agent: AgentStep["agent"]; calls: Call[] };

/** The run as turns: a turn is one agent's calls until the case changes hands. `n` counts the calls shown. */
export function turnsOf(run: Pick<AgentRun, "steps" | "tool_calls">): Turn[] {
  const turns: Turn[] = [];
  let n = 0;
  run.steps.forEach((s, i) => {
    if (!s || isOpeningRead(s, i)) return;
    const { case_id: _omit, ...args } = (run.tool_calls[i]?.args ?? {}) as Record<string, unknown>;
    const call = { ...s, args, n: n++ };
    const last = turns[turns.length - 1];
    if (last && last.agent === s.agent) last.calls.push(call);
    else turns.push({ agent: s.agent, calls: [call] });
  });
  return turns;
}

const WHY: Record<string, string> = {
  critic: "called by the gate: something no suspect explains",
};

export function AgentTrace({
  run,
  about,
  tookMs,
  running,
  upTo,
  current,
}: {
  run: Pick<AgentRun, "steps" | "tool_calls" | "model" | "live" | "rounds" | "fallback" | "stopped" | "thoughts">;
  about: AgentAbout | null;
  tookMs?: number;
  /** The run is still going: its totals are not known yet. */
  running?: boolean;
  /** Show calls up to this one only, while the run is being shown on the stage. */
  upTo?: number;
  /** The call on the stage now. */
  current?: number;
}) {
  const turns = turnsOf(run);
  const brain = runBrain(run.model, run.live);
  const limit = upTo ?? Infinity;
  const critics = turns.filter((t) => t.agent === "critic").length;

  return (
    <Card
      className="worklog"
      title="Work log"
      icon={<Bot size={15} />}
      flush
      actions={
        about && (
          <Hint label="About the work log">
            Every call Crux's AI made, and the physics' answer. Limits: {about.limits.rounds} rounds, {about.limits.model_calls} model calls, {about.limits.seconds} s.
          </Hint>
        )
      }
      foot={running ? "Calls appear as the server reports them." : undefined}
    >
      {!running && (
        <div className="trace-head">
          <Badge tone={brain.live ? "ok" : "neutral"} dot title={run.model}>
            {brain.name}
          </Badge>
          {run.fallback && <Badge tone="warn">fell back: {run.fallback}</Badge>}
          {run.stopped && <Badge tone="warn">stopped: {run.stopped}</Badge>}
          <span className="trace-sum num">
            {run.rounds}
            {about ? ` of ${about.limits.rounds}` : ""} rounds · {run.tool_calls.length} calls · {critics} critic turn{critics === 1 ? "" : "s"}
            {tookMs ? ` · ${num(tookMs / 1000, 1)} s` : ""}
          </span>
        </div>
      )}
      {turns.map((t, ti) => {
        const calls = t.calls.filter((c) => c.n <= limit);
        if (calls.length === 0) return null;
        return (
          <div className={cx("turn", t.agent)} key={ti}>
            <div className="turn-head">
              <span className="who">
                {t.agent === "critic" ? <Search size={12} /> : <Bot size={12} />}
                {t.agent === "critic" ? "Critic" : "Investigator"}
              </span>
              <span className="turn-why">{WHY[t.agent] ?? (ti === 0 ? "opens" : "takes it back")}</span>
            </div>
            {calls.map((c) => (
              <Step key={c.n} call={c} now={c.n === current} />
            ))}
          </div>
        );
      })}
      {turns.length === 0 && <div className="empty left">No call yet.</div>}
      {!running && run.thoughts.length > 0 && (
        <div className="turn">
          <div className="turn-head">
            <span className="who" style={{ background: "var(--model-soft)", color: "var(--model)" }}>
              <Sparkles size={12} /> The model's notes
            </span>
          </div>
          {run.thoughts.map((t, i) => (
            <p key={i} className="step-say" style={{ marginBottom: 8 }}>
              {t}
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}

function Step({ call, now }: { call: Call; now?: boolean }) {
  const hasArgs = Object.keys(call.args).length > 0;
  if (call.kind === "says") {
    return (
      <div className={cx("step", "says", now && "now")}>
        <div className="step-tool">
          narrate <span className="dim" style={{ fontWeight: 450 }}>· not evidence</span>
        </div>
        <p className="step-say">{plainSentence(call.asked)}</p>
      </div>
    );
  }
  return (
    <div className={cx("step", now && "now")}>
      <div className="step-tool">{call.tool}</div>
      <div className="step-ask">{call.asked}</div>
      {call.answered && (
        <div className="step-answer">
          <CornerDownRight size={13} aria-hidden />
          <span>{plainSentence(call.answered)}</span>
        </div>
      )}
      {hasArgs && (
        <details>
          <summary>arguments sent</summary>
          <pre>{JSON.stringify(call.args, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

export function EngineLog({ transcript, machine }: { transcript: string[]; machine: string }) {
  return (
    <Card className="enginelog" title="Engine log" icon={<ScrollText size={15} />} flush actions={<EngineWords />}>
      <ol className="log">
        {transcript.map((t, i) => (
          <li key={i}>
            <span>{String(i + 1).padStart(2, "0")}</span>
            <div>{plainSentence(t.replace(ENGINE_MACHINE_NAME, machine))}</div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
