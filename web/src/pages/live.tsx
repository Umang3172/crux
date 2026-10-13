// Crux at work, for any page: the investigation on stage, the call it is on,
// and its latest moves.

import { useEffect, useMemo } from "react";
import { Link } from "react-router";
import { Activity } from "lucide-react";
import type { AgentAbout } from "../api/types";
import { runBrain } from "../lib/ai";
import { agentName, callWords } from "../lib/calls";
import { publishShown, useShown, useShownProgress, withdrawShown } from "../lib/floorplay";
import { useAbout } from "../lib/hooks";
import { shownSteps, useLiveRun } from "../lib/liveruns";
import { plainSentence } from "../lib/plain";
import { machineOfCase } from "../lib/plant";
import { usePlayback } from "../lib/playback";
import { useSession } from "../lib/session";
import { AgentStage } from "../ui/AgentStage";
import { Badge, Card, Empty, cx } from "../ui/kit";

/** Plays one investigation for everything on the page that shows it. Draws nothing itself. */
export function FloorPlayer({ caseId, speed = 1 }: { caseId: string; speed?: number }) {
  const live = useLiveRun(caseId);
  const raw = live?.steps;
  const steps = useMemo(() => shownSteps(raw ?? []), [raw]);
  const streaming = !live || live.streaming;
  const pb = usePlayback(steps, { streaming, quick: true, autoplay: true, runKey: caseId, speed });
  // The player redraws once a frame while it plays; each frame is handed on.
  useEffect(() => publishShown(caseId, { play: { ...pb.play }, steps, streaming }));
  useEffect(() => () => withdrawShown(caseId), [caseId]);
  return null;
}

function OwnStage({ caseId, about }: { caseId: string | undefined; about: AgentAbout | null }) {
  const live = useLiveRun(caseId);
  const raw = live?.steps;
  const steps = useMemo(() => shownSteps(raw ?? []), [raw]);
  const streaming = !live || live.streaming;
  const pb = usePlayback(steps, { streaming, quick: true, autoplay: true, runKey: caseId ?? "none" });
  return <AgentStage about={about} steps={steps} play={pb.play} streaming={streaming} compact />;
}

/** One investigation, drawn call by call as it arrives. */
export function LiveStage({ caseId }: { caseId: string | undefined }) {
  const about = useAbout();
  const shared = useShown(caseId);
  if (shared) return <AgentStage about={about.data} steps={shared.steps} play={shared.play} streaming={shared.streaming} compact />;
  return <OwnStage caseId={caseId} about={about.data} />;
}

function OwnCall({ caseId }: { caseId: string | undefined }) {
  const live = useLiveRun(caseId);
  const raw = live?.steps;
  const steps = useMemo(() => shownSteps(raw ?? []), [raw]);
  const pb = usePlayback(steps, { streaming: !live || live.streaming, quick: true, autoplay: true, runKey: caseId ?? "none" });
  return <CallWords agent={steps[pb.play.at]?.agent} tool={steps[pb.play.at]?.tool} />;
}

function CallWords({ agent, tool }: { agent?: string; tool?: string }) {
  if (!agent || !tool) return <>starting…</>;
  return (
    <>
      <b className={cx("call-who", agent)}>{agentName(agent)}</b> {callWords(tool)}
    </>
  );
}

/** What an investigation is doing right now, in a few plain words, for a machine's tile. */
export function LiveCall({ caseId }: { caseId: string | undefined }) {
  const shared = useShownProgress(caseId);
  if (shared) return <CallWords agent={shared.step?.agent} tool={shared.step?.tool} />;
  return <OwnCall caseId={caseId} />;
}

/** Crux's latest moves across this session's investigations. */
export function ActivityFeed() {
  const session = useSession();
  const runs = [...session.cases].filter((c) => c.kind === "agents" && c.run).sort((a, b) => b.createdAt - a.createdAt);
  const calls = runs
    .slice(0, 4)
    .flatMap((c) =>
      c
        .run!.steps.filter((s, i) => s && !(i === 0 && s.tool === "get_case"))
        // Re-reading the evidence and narrating move nothing; the feed shows the calls that did.
        .filter((s) => s.kind === "asks" && s.tool !== "get_case")
        .slice(-1)
        .map((s) => ({ ...s, caseId: c.id, machine: machineOfCase(c).short })),
    )
    .slice(0, 4);
  const standIn = runs.slice(0, 4).some((c) => !runBrain(c.run!.model, c.run!.live).live);

  return (
    <Card title="Crux at work" icon={<Activity size={15} />} actions={standIn ? <Badge plain>offline stand-in</Badge> : undefined} flush>
      {calls.length === 0 ? (
        <Empty left title="Nothing investigated yet" />
      ) : (
        <ul className="feed feed-tight">
          {calls.map((s) => (
            <li key={s.caseId}>
              <span className={cx("feed-dot", s.agent)} aria-hidden />
              <Link to={`/cases/${s.caseId}`} className="feed-row" title={plainSentence(s.answered ?? s.asked)}>
                <span className="feed-what">
                  <b>{s.machine}</b> {callWords(s.tool)}
                </span>
                <span className="feed-said">{plainSentence(s.answered ?? s.asked)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
