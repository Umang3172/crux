// How Crux works, drawn from what the server reports about itself: the two AI
// investigators, the tools each was given, the limits on an investigation and
// which model drives each job. The words explain; every name, tool and limit
// on the page is the server's.

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Activity, ArrowLeftRight, ArrowRight, Bot, Check, FileCheck, FlaskConical, ListChecks, Lock, Play, Ruler, Scale, Search, ShieldCheck, Timer, Workflow } from "lucide-react";
import { openLauncher } from "../app/Launcher";
import type { AgentAbout } from "../api/types";
import { brainOf, fallbackReason, runBrain } from "../lib/ai";
import { modelOf } from "../lib/casemodel";
import { pct, shortId, stamp } from "../lib/format";
import { useAbout, useHealth, useReducedMotion } from "../lib/hooks";
import { shownSteps } from "../lib/liveruns";
import { usePlayback } from "../lib/playback";
import { CONCLUDE_AT } from "../lib/plain";
import { machineOfCase } from "../lib/plant";
import { useSession, type CaseEntry } from "../lib/session";
import { AgentStage } from "../ui/AgentStage";
import { Badge, Button, Card, Details, Empty, ErrorState, Hint, LinkButton, PageHead, SkeletonRows, cx } from "../ui/kit";
import { Link } from "react-router";
import { finding } from "./parts";
import { AiJobs, Limits } from "./trust/Jobs";
import { useSeenOnce } from "./trust/seen";
import "../styles/viz.css";
import "./pages.css";
import "../styles/trust.css";

const CLOSES = new Set(["conclude", "declare_unresolved"]);
const WRITES = new Set(["propose_suspect"]);
const NAME: Record<string, string> = { investigator: "Investigator", critic: "Critic" };

type Agent = AgentAbout["agents"][number];

function Steps() {
  const steps = [
    { icon: <Activity size={16} />, tone: "", title: "A reading comes in", sub: "Vibration from a pump, fan or motor." },
    { icon: <FlaskConical size={16} />, tone: "tone-sim", title: "Every suspect is tested on a virtual copy", sub: `A cause is named only at ${pct(CONCLUDE_AT)} belief.` },
    { icon: <Ruler size={16} />, tone: "tone-accent", title: "One measurement, only if it cannot tell", sub: "Then a person approves any repair." },
  ];
  return (
    <ol className="tr-steps tr-in" id="how-steps" aria-label="How an investigation goes">
      {steps.map((s, i) => (
        <li key={s.title} className="tr-step" style={{ "--i": i } as CSSProperties}>
          {i > 0 && (
            <span className="tr-join" aria-hidden>
              <ArrowRight size={13} />
            </span>
          )}
          <span className={cx("tr-ico", s.tone)}>{s.icon}</span>
          <div>
            <span className="tr-step-n">Step {i + 1}</span>
            <h3>{s.title}</h3>
            <p>{s.sub}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Power({ can, label, tools }: { can: boolean; label: string; tools: string[] }) {
  return (
    <div className={cx("tr-power", can ? "can" : "cannot")}>
      {can ? <Check size={15} aria-hidden /> : <Lock size={14} aria-hidden />}
      <b>{label}</b>
      {can && tools.length > 0 && (
        <div className="tools">
          {tools.map((t) => (
            <span key={t} className="tool">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Side({ agent, icon }: { agent: Agent; icon: ReactNode }) {
  const closes = agent.tools.filter((t) => CLOSES.has(t));
  const writes = agent.tools.filter((t) => WRITES.has(t));
  const name = NAME[agent.name] ?? agent.name;
  return (
    <section className="tr-side" aria-label={name}>
      <div className="tr-side-head">
        <span className="tr-ico tone-model">{icon}</span>
        <h3>{name}</h3>
        <Hint label={`What the ${name.toLowerCase()} does`}>{agent.job}</Hint>
        <span className="tr-limit push">
          <b>{agent.tools.length}</b> tools
        </span>
      </div>
      <Power can={closes.length > 0} label={closes.length > 0 ? "Closes an investigation" : "Cannot close an investigation"} tools={closes} />
      <Power can={writes.length > 0} label={writes.length > 0 ? "Writes a suspect the list lacks" : "Cannot write a suspect"} tools={writes} />
    </section>
  );
}

/** Who may do what, read from the tools each investigator was given. */
function Split({ about }: { about: AgentAbout }) {
  const investigator = about.agents.find((a) => a.name === "investigator");
  const critic = about.agents.find((a) => a.name === "critic");
  const others = about.agents.filter((a) => a !== investigator && a !== critic);
  const both = about.agents.some((x) => x.tools.some((t) => CLOSES.has(t)) && x.tools.some((t) => WRITES.has(t)));
  return (
    <Card id="who-may-do-what" title="Two AI investigators" icon={<Bot size={15} />}>
      <div className="tr-split">
        {investigator && <Side agent={investigator} icon={<Bot size={16} />} />}
        <div className="tr-gate">
          <ArrowLeftRight size={18} aria-hidden />
          <b>The gate</b>
          <span>Rules in code pick who goes next.</span>
          <Hint label="What the gate does">After each turn it hands the investigation back to the investigator, calls the critic once when something is explained by no suspect, or stops. It is never a model.</Hint>
        </div>
        {critic && <Side agent={critic} icon={<Search size={16} />} />}
        {others.map((a) => (
          <Side key={a.name} agent={a} icon={<Bot size={16} />} />
        ))}
      </div>
      {!both && (
        <p className="tr-split-foot" style={{ marginTop: "var(--s-4)" }}>
          <ShieldCheck size={15} aria-hidden />
          No investigator can both write a suspect and close an investigation.
        </p>
      )}
    </Card>
  );
}

function Honest({ about }: { about: AgentAbout }) {
  const takesNumbers = about.tools.filter((t) => t.takes.some((arg) => /prob|belief|score|reading|value|posterior|likelihood/i.test(arg)));
  const rules: { icon: ReactNode; title: string; sub: ReactNode; hint: string }[] = [
    {
      icon: <Scale size={16} />,
      title: "Only physics moves a belief.",
      sub: takesNumbers.length === 0 ? "No tool takes a probability, a score or a reading." : `Tools that take a value: ${takesNumbers.map((t) => t.name).join(", ")}.`,
      hint: "Beliefs change through simulated likelihoods and measured evidence. A model's call can start an experiment; it cannot supply the result.",
    },
    {
      icon: <FlaskConical size={16} />,
      title: "A written suspect is tested, not trusted.",
      sub: "Simulated and scored like every other.",
      hint: "The critic may write a cause the list lacks. The engine simulates it and scores it against the same evidence as every other suspect. One that cites a document is refused unless its numbers are in the passage.",
    },
    {
      icon: <Timer size={16} />,
      title: "Code ends an investigation, not a model.",
      sub: <Limits limits={about.limits} />,
      hint: "A verdict is refused while the leader is below the bar or something in the reading is unexplained. These limits stop one that does not finish.",
    },
    {
      icon: <FileCheck size={16} />,
      title: "Every sentence it writes cites evidence.",
      sub: "Unbacked ones are removed, and shown removed.",
      hint: "Each sentence of an explanation must cite evidence. One that states a number or names a cause its evidence does not carry is removed and shown as removed.",
    },
  ];
  return (
    <section className="tr-section" id="how-honest" aria-labelledby="tr-honest">
      <div className="tr-section-head">
        <h2 id="tr-honest">What keeps the AI honest</h2>
      </div>
      <div className="tr-rules tr-in">
        {rules.map((r, i) => (
          <div key={r.title} className="tr-rule" style={{ "--i": i } as CSSProperties}>
            <div className="tr-rule-top">
              <span className="tr-ico">{r.icon}</span>
              <b>{r.title}</b>
              <Hint>{r.hint}</Hint>
            </div>
            <div className="small dim">{r.sub}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The session's latest AI investigation, replayed call by call once it is on screen. */
function LatestRun({ entry, about }: { entry: CaseEntry; about: AgentAbout }) {
  const steps = shownSteps(entry.run?.steps ?? []);
  const pb = usePlayback(steps, { streaming: false, autoplay: false, runKey: entry.id });
  const reduce = useReducedMotion();
  const [ref, seen] = useSeenOnce<HTMLDivElement>(0.4);
  const started = useRef(false);
  useEffect(() => {
    if (!seen || started.current) return;
    started.current = true;
    // With less motion asked for, the record is shown finished instead of played.
    if (reduce) pb.finish();
    else pb.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, reduce]);
  const m = modelOf(entry);
  const run = entry.run!;
  const brain = runBrain(run.model, run.live);
  return (
    <Card
      id="latest-investigation"
      title="Its latest investigation"
      icon={<Workflow size={15} />}
      sub={`${machineOfCase(entry).short}${m ? ` · ${finding(m).toLowerCase()}` : ""}`}
      actions={
        <>
          <Badge tone={brain.live ? "ok" : "neutral"} dot={brain.live} title={run.model}>
            {brain.name}
          </Badge>
          <LinkButton to={`/cases/${entry.id}`} size="sm">
            Open investigation
          </LinkButton>
        </>
      }
      foot={run.live ? undefined : "Offline stand-in: its choices are scripted. Its tools and the physics are real."}
    >
      <div ref={ref} className="tr-stage">
        <AgentStage about={about} steps={steps} play={pb.play} streaming={false} experiments={m?.experiments} controls={pb} />
        <div className="tr-legend" style={{ marginTop: "var(--s-2)" }}>
          <span>
            <i style={{ background: "var(--model)" }} /> the AI asks
          </span>
          <span>
            <i style={{ background: "var(--accent)" }} /> the physics answers
          </span>
          <span>
            <i style={{ background: "var(--sim)" }} /> a virtual experiment
          </span>
        </div>
      </div>
    </Card>
  );
}

export default function Agents() {
  const about = useAbout();
  const health = useHealth();
  const session = useSession();
  const runs = session.cases.filter((c) => c.kind === "agents" && c.run).sort((a, b) => b.createdAt - a.createdAt);

  if (about.error) {
    return (
      <div className="page tr-page">
        <ErrorState error={about.error} onRetry={about.reload} />
      </div>
    );
  }
  const a = about.data;
  const configured = health.data?.models.investigator;
  const brain = brainOf(configured);
  const why = health.data ? fallbackReason(health.data.models, "investigator") : null;
  const watch = () => openLauncher({ investigator: "agents" });

  return (
    <div className="page tr-page">
      <PageHead
        title="How Crux works"
        sub="The AI may ask the physics anything. It cannot tell it the answer."
        actions={
          <>
            <span className="tr-with-hint">
              <Badge tone={brain.live ? "ok" : "neutral"} dot={brain.live} title={configured}>
                Crux's AI: {health.data ? brain.name : health.error ? "unknown" : "…"}
              </Badge>
              <Hint label="Which model drives the investigators">
                {brain.live
                  ? `Configured on this server: ${configured}.`
                  : "No model credentials on this server, so a scripted stand-in drives the same tools through the same loop. Its calls and the physics' answers are real; its choices are scripted."}
                {why && ` ${why}`}
              </Hint>
            </span>
            {runs[0] && (
              <Button icon={<Play size={14} />} onClick={watch}>
                Watch another
              </Button>
            )}
          </>
        }
      />

      <Steps />

      {!a ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : (
        <>
          <Split about={a} />

          <Honest about={a} />

          {runs[0] ? (
            <LatestRun key={runs[0].id} entry={runs[0]} about={a} />
          ) : (
            <Card id="latest-investigation" title="Its latest investigation" icon={<Workflow size={15} />}>
              <Empty
                icon={<Play size={18} />}
                title="Nothing to replay yet"
                action={
                  <Button variant="primary" icon={<Play size={14} />} onClick={watch}>
                    Watch an investigation
                  </Button>
                }
              >
                Start one and it replays here, step by step.
              </Empty>
            </Card>
          )}

          <Card title="Reference" icon={<ListChecks size={15} />} flush>
            <div className="tr-more">
              <Details
                summary={
                  <>
                    Every tool <span className="dim">· {a.tools.length}</span>
                  </>
                }
              >
                <div className="table-wrap">
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
              </Details>
              <Details summary="Which model does which job">{health.data ? <AiJobs models={health.data.models} /> : <SkeletonRows rows={3} />}</Details>
              {runs.length > 0 && (
                <Details
                  summary={
                    <>
                      AI investigations this session <span className="dim">· {runs.length}</span>
                    </>
                  }
                >
                  <div className="table-wrap">
                    <table className="table compact">
                      <thead>
                        <tr>
                          <th>Machine</th>
                          <th>Ended as</th>
                          <th>Model</th>
                          <th className="t-num">Rounds</th>
                          <th className="t-num">Steps</th>
                          <th>Critic</th>
                          <th className="t-num">Opened</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runs.map((c) => {
                          const m = modelOf(c);
                          const run = c.run!;
                          const b = runBrain(run.model, run.live);
                          return (
                            <tr key={c.id}>
                              <td className="nowrap">
                                <Link to={`/cases/${c.id}`}>{machineOfCase(c).short}</Link> <span className="mono dim small">{shortId(c.id)}</span>
                              </td>
                              <td className="strong">{m ? finding(m) : "–"}</td>
                              <td>
                                <Badge tone={b.live ? "ok" : "neutral"} title={run.model}>
                                  {b.name}
                                </Badge>
                              </td>
                              <td className="t-num">{run.rounds}</td>
                              <td className="t-num">{run.tool_calls.length}</td>
                              <td>{run.steps.some((s) => s.agent === "critic") ? <Badge tone="model">called</Badge> : <span className="dim">not needed</span>}</td>
                              <td className="t-num dim-cell">{stamp(c.createdAt)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Details>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
