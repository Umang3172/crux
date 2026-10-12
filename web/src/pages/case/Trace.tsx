// What did the work. For an agent run: every tool call, by which agent, and
// the physics' answer to it. For an engine case: the engine's own log.

import { Bot, CornerDownRight, Play, ScrollText, Search, Sparkles } from "lucide-react";
import type { AgentAbout, AgentRun, AgentStep } from "../../api/types";
import { runBrain } from "../../lib/ai";
import { num } from "../../lib/format";
import { useStepper } from "../../lib/hooks";
import { plainSentence } from "../../lib/plain";
import { ENGINE_MACHINE_NAME, PUMP } from "../../lib/scenarios";
import { Badge, Button, Card, cx } from "../../ui/kit";

type Call = AgentStep & { args: Record<string, unknown> };
type Turn = { agent: AgentStep["agent"]; calls: Call[] };

/** The run's first step reads the case before any experiment has run and reports nothing true yet. */
const beforeAnyExperiment = (s: AgentStep, i: number) => i < 2 && s.tool === "get_case" && /Nothing stands in the way/.test(s.answered ?? "");

export function turnsOf(run: AgentRun): Turn[] {
  const turns: Turn[] = [];
  run.steps.forEach((s, i) => {
    if (beforeAnyExperiment(s, i)) return;
    const { case_id: _omit, ...args } = (run.tool_calls[i]?.args ?? {}) as Record<string, unknown>;
    const last = turns[turns.length - 1];
    if (last && last.agent === s.agent) last.calls.push({ ...s, args });
    else turns.push({ agent: s.agent, calls: [{ ...s, args }] });
  });
  return turns;
}

const WHY: Record<string, string> = {
  critic: "called by the gate: something in the capture is explained by no suspect",
};

export function AgentTrace({ run, about, tookMs, id }: { run: AgentRun; about: AgentAbout | null; tookMs?: number; id: string }) {
  const turns = turnsOf(run);
  const total = turns.reduce((n, t) => n + t.calls.length, 0);
  const [shown, replay, playing] = useStepper(total, 420, id);
  const brain = runBrain(run.model, run.live);
  let seen = 0;

  return (
    <Card
      title="Agent run"
      icon={<Bot size={15} />}
      flush
      actions={
        <Button size="sm" icon={<Play size={12} />} onClick={replay} disabled={playing}>
          {playing ? "Replaying" : "Replay"}
        </Button>
      }
      foot={
        <>
          The run finished on the server before it was shown{tookMs ? ` (the request took ${num(tookMs / 1000, 1)} s)` : ""}; this is its record in order.
          {about && ` Limits: ${about.limits.rounds} rounds, ${about.limits.model_calls} model calls, ${about.limits.seconds} s.`}
        </>
      }
    >
      <div className="trace-head">
        <Badge tone={brain.live ? "ok" : "neutral"} dot title={run.model}>
          {brain.name}
        </Badge>
        {!run.live && <Badge title={run.model}>no Gemini credentials on this server</Badge>}
        {run.fallback && <Badge tone="warn">fell back: {run.fallback}</Badge>}
        {run.stopped && <Badge tone="warn">stopped: {run.stopped}</Badge>}
      </div>
      <div className="budget">
        <div>
          <b>
            {run.rounds}
            {about && <span className="dim" style={{ fontWeight: 450 }}> of {about.limits.rounds}</span>}
          </b>
          <span>rounds</span>
        </div>
        <div>
          <b>{run.tool_calls.length}</b>
          <span>tool calls</span>
        </div>
        <div>
          <b>{turns.filter((t) => t.agent === "critic").length}</b>
          <span>critic turns</span>
        </div>
      </div>
      {turns.map((t, ti) => {
        const start = seen;
        seen += t.calls.length;
        if (start >= shown) return null;
        return (
          <div className={cx("turn", t.agent)} key={ti}>
            <div className="turn-head">
              <span className="who">
                {t.agent === "critic" ? <Search size={12} /> : <Bot size={12} />}
                {t.agent === "critic" ? "Critic" : "Investigator"}
              </span>
              <span className="turn-why">{WHY[t.agent] ?? (ti === 0 ? "opens the case" : "takes the case back")}</span>
            </div>
            {t.calls.slice(0, Math.max(0, shown - start)).map((c, ci) => (
              <Step key={ci} call={c} />
            ))}
          </div>
        );
      })}
      {run.thoughts.length > 0 && (
        <div className="turn">
          <div className="turn-head">
            <span className="who" style={{ background: "var(--model-soft)", color: "var(--model)" }}>
              <Sparkles size={12} /> The model's own notes
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

function Step({ call }: { call: Call }) {
  const hasArgs = Object.keys(call.args).length > 0;
  if (call.kind === "says") {
    return (
      <div className="step says">
        <div className="step-tool">
          narrate <span className="dim" style={{ fontWeight: 450 }}>· shown as narration, never as evidence</span>
        </div>
        <p className="step-say">{plainSentence(call.asked)}</p>
      </div>
    );
  }
  return (
    <div className="step">
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
          <summary>what the model sent</summary>
          <pre>{JSON.stringify(call.args, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

export function EngineLog({ transcript }: { transcript: string[] }) {
  return (
    <Card title="Engine log" icon={<ScrollText size={15} />} sub="what the engine did, in its own words" flush>
      <ol className="log">
        {transcript.map((t, i) => (
          <li key={i}>
            <span>{String(i + 1).padStart(2, "0")}</span>
            <div>{plainSentence(t.replace(ENGINE_MACHINE_NAME, PUMP.short))}</div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
