// The agent system, drawn from what the server reports about itself: the two
// agents, the tools each was given, the limits on a run, and which model
// drives each job. Nothing on this page is typed in by hand except the words
// that explain it.

import { ArrowLeftRight, Bot, Gavel, Lock, Play, Search, ShieldCheck, Workflow } from "lucide-react";
import { openLauncher } from "../app/Launcher";
import type { AgentAbout } from "../api/types";
import { AI_JOBS, brainOf, fallbackReason } from "../lib/ai";
import { modelOf } from "../lib/casemodel";
import { shortId, stamp } from "../lib/format";
import { useAbout, useHealth } from "../lib/hooks";
import { useSession } from "../lib/session";
import { Badge, Button, Callout, Card, Empty, ErrorState, PageHead, SkeletonRows, Stat, cx } from "../ui/kit";
import { Link } from "react-router";
import { finding } from "./parts";
import "./pages.css";

const CLOSES = new Set(["conclude", "declare_unresolved"]);
const WRITES = new Set(["propose_suspect"]);

function ToolList({ about, agent }: { about: AgentAbout; agent: AgentAbout["agents"][number] }) {
  const other = about.agents.find((a) => a.name !== agent.name);
  return (
    <div className="tools">
      {agent.tools.map((t) => {
        const shared = other?.tools.includes(t);
        const does = about.tools.find((x) => x.name === t)?.does ?? "";
        return (
          <span key={t} className={cx("tool", shared && "shared", CLOSES.has(t) && "closes", WRITES.has(t) && "writes")} data-tip={does}>
            {CLOSES.has(t) && <Gavel size={10} />}
            {WRITES.has(t) && <Search size={10} />}
            {t}
          </span>
        );
      })}
    </div>
  );
}

export default function Agents() {
  const about = useAbout();
  const health = useHealth();
  const session = useSession();
  const runs = session.cases.filter((c) => c.kind === "agents" && c.run).sort((a, b) => b.createdAt - a.createdAt);

  if (about.error) {
    return (
      <div className="page">
        <ErrorState error={about.error} onRetry={about.reload} />
      </div>
    );
  }
  const a = about.data;
  const investigator = a?.agents.find((x) => x.name === "investigator");
  const critic = a?.agents.find((x) => x.name === "critic");
  const brain = brainOf(health.data?.models.investigator);
  const takesNumbers = a?.tools.filter((t) => t.takes.some((arg) => /prob|belief|score|reading|value|posterior|likelihood/i.test(arg))) ?? [];

  return (
    <div className="page">
      <PageHead
        title="Agents"
        sub="Two agents work a case through the engine's tools. Code decides whose turn it is and when a run ends. An agent can ask the physics anything; it cannot tell the physics what the answer is."
        actions={
          <Button variant="primary" icon={<Play size={14} />} onClick={() => openLauncher({ investigator: "agents" })}>
            Run the agents on a case
          </Button>
        }
      />

      {!a ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : (
        <>
          <div className="stats">
            <Stat label="Agents" value={a.agents.length} sub="each with its own tools" />
            <Stat label="Tools" value={a.tools.length} sub={`${a.agents.reduce((n, x) => n + x.tools.length, 0) - a.tools.length} shared by both`} />
            <Stat label="Rounds per run" value={a.limits.rounds} unit="at most" sub="then code ends the run" />
            <Stat label="Model calls per run" value={a.limits.model_calls} unit="at most" sub={`and ${a.limits.seconds} s`} />
            <Stat label="Runs on" value={<span style={{ fontSize: "1.25rem" }}>{health.data ? brain.name : "…"}</span>} sub={brain.live ? "a live model" : "no model credentials on this server"} />
          </div>

          <Card title="The loop" icon={<Workflow size={15} />} sub="who may do what">
            <div className="loop">
              {investigator && (
                <div className="agent-box investigator">
                  <h3>
                    <Bot size={16} className="t-accent" /> Investigator
                    <Badge tone="accent">{investigator.tools.length} tools</Badge>
                  </h3>
                  <p className="muted" style={{ marginTop: 6 }}>
                    {investigator.job}
                  </p>
                  <ToolList about={a} agent={investigator} />
                </div>
              )}
              <div className="gate">
                <ArrowLeftRight size={18} />
                <b>The gate</b>
                <span>Rules in code, not a model. After each turn it sends the case back to the investigator, calls the critic once when something is explained by no suspect, or stops the run.</span>
              </div>
              {critic && (
                <div className="agent-box critic">
                  <h3>
                    <Search size={16} className="t-model" /> Critic
                    <Badge tone="model">{critic.tools.length} tools</Badge>
                  </h3>
                  <p className="muted" style={{ marginTop: 6 }}>
                    {critic.job}
                  </p>
                  <ToolList about={a} agent={critic} />
                </div>
              )}
            </div>
            <div className="row row-wrap small muted" style={{ marginTop: 14 }}>
              <span className="tool closes">
                <Gavel size={10} /> closes a case
              </span>
              <span className="tool writes">
                <Search size={10} /> writes a suspect
              </span>
              <span className="tool shared">shared by both</span>
              <span>
                Hover a tool to read what it does.
                {!a.agents.some((x) => x.tools.some((t) => CLOSES.has(t)) && x.tools.some((t) => WRITES.has(t))) && " No agent has both a tool that writes a suspect and a tool that closes a case."}
              </span>
            </div>
          </Card>

          <div className="grid-2" style={{ alignItems: "start" }}>
            <Card title="Every tool, and what it takes" icon={<Lock size={15} />} flush foot={takesNumbers.length === 0 ? "No tool takes a probability, a score or a reading. Readings come in through a separate door that only a sensor or a person uses." : undefined}>
              <div className="table-wrap" style={{ maxHeight: 640, overflowY: "auto" }}>
                <table className="table compact t-top">
                  <thead>
                    <tr>
                      <th>Tool</th>
                      <th>What it does</th>
                      <th>Takes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.tools.map((t) => (
                      <tr key={t.name}>
                        <td className="mono nowrap strong" style={{ verticalAlign: "top" }}>
                          {t.name}
                        </td>
                        <td className="muted">{t.does}</td>
                        <td style={{ verticalAlign: "top" }}>
                          {t.takes.length === 0 ? (
                            <span className="dim">nothing</span>
                          ) : (
                            <span className="row gap-1 row-wrap">
                              {t.takes.map((x) => (
                                <span key={x} className="chip">
                                  {x}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="col" style={{ gap: "var(--s-5)" }}>
              <Card title="What keeps the agents honest" icon={<ShieldCheck size={15} />}>
                <ul className="col gap-3">
                  <li>
                    <b>Only physics moves a belief.</b> <span className="muted">Beliefs change through simulated likelihoods and measured evidence. A model's tool call can start an experiment; it cannot supply its result.</span>
                  </li>
                  <li>
                    <b>A written suspect is tested, not trusted.</b> <span className="muted">The critic may write a cause the list lacks. The engine simulates it and scores it against the same evidence as every other suspect. One that cites a document is refused unless its numbers are in the passage.</span>
                  </li>
                  <li>
                    <b>Code ends the run.</b> <span className="muted">A verdict is refused while the leader is below the bar or something in the capture is unexplained. The limits above stop a run that does not finish.</span>
                  </li>
                  <li>
                    <b>What a model writes is checked.</b> <span className="muted">Each sentence of an explanation must cite evidence; one that states a number or names a cause its evidence does not carry is removed and shown as removed.</span>
                  </li>
                </ul>
              </Card>

              <Card title="Which model does which job" icon={<Bot size={15} />} flush>
                <table className="table compact">
                  <tbody>
                    {health.data &&
                      AI_JOBS.map((j) => {
                        const configured = health.data!.models[j.key] as string;
                        const b = j.key === "gate" ? { name: "rules in code", live: false } : brainOf(configured);
                        const why = fallbackReason(health.data!.models, j.key);
                        return (
                          <tr key={j.key}>
                            <td>
                              <b>{j.label}</b>
                              <div className="small dim">{b.live || j.key === "gate" ? j.does : j.instead}</div>
                              {why && <div className="small t-warn">{why}</div>}
                            </td>
                            <td style={{ textAlign: "right", verticalAlign: "top" }}>
                              <Badge tone={b.live ? "ok" : "neutral"} dot={b.live} title={configured}>
                                {b.name}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </Card>
            </div>
          </div>

          {!brain.live && (
            <Callout tone="model">
              No model credentials are set on this server, so a scripted stand-in drives the same tools through the same loop. Its tool calls and the physics' answers are real; its choices are scripted, and every screen that shows them says so.
            </Callout>
          )}

          <Card title="Runs in this session" icon={<Bot size={15} />} flush>
            {runs.length === 0 ? (
              <Empty left title="The agents have not run yet">
                Start one with “Run the agents on a case”, or send them the whole fault set from the overview.
              </Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Case</th>
                      <th>Ended as</th>
                      <th>Model</th>
                      <th className="t-num">Rounds</th>
                      <th className="t-num">Tool calls</th>
                      <th>Critic</th>
                      <th className="t-num">Opened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((c) => {
                      const m = modelOf(c);
                      const run = c.run!;
                      const criticCalled = run.steps.some((s) => s.agent === "critic");
                      return (
                        <tr key={c.id} className="hover">
                          <td className="mono">
                            <Link to={`/cases/${c.id}`}>{shortId(c.id)}</Link>
                          </td>
                          <td className="strong">{m ? finding(m) : "–"}</td>
                          <td>
                            <Badge tone={run.live ? "ok" : "neutral"} title={run.model}>
                              {run.live ? run.model : "offline stand-in"}
                            </Badge>
                          </td>
                          <td className="t-num">{run.rounds}</td>
                          <td className="t-num">{run.tool_calls.length}</td>
                          <td>{criticCalled ? <Badge tone="model">called</Badge> : <span className="dim">not needed</span>}</td>
                          <td className="t-num dim-cell">{stamp(c.createdAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
