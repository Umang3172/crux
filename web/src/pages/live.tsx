// Crux at work, for any page: the investigation on stage, and its latest moves.

import { Link } from "react-router";
import { Activity, Sparkles } from "lucide-react";
import { shortId } from "../lib/format";
import { useAbout } from "../lib/hooks";
import { shownSteps, useLiveRun } from "../lib/liveruns";
import { plainSentence } from "../lib/plain";
import { machineOfCase } from "../lib/plant";
import { usePlayback } from "../lib/playback";
import { useSession } from "../lib/session";
import { AgentStage } from "../ui/AgentStage";
import { Card, Empty, cx } from "../ui/kit";
import { turnsOf } from "./case/Trace";

/** One investigation, drawn call by call as it arrives. */
export function LiveStage({ caseId }: { caseId: string | undefined }) {
  const about = useAbout();
  const live = useLiveRun(caseId);
  const steps = shownSteps(live?.steps ?? []);
  const streaming = !live || live.streaming;
  const pb = usePlayback(steps, { streaming, quick: true, autoplay: true, runKey: caseId ?? "none" });
  return <AgentStage about={about.data} steps={steps} play={pb.play} streaming={streaming} compact />;
}

/** The tool an investigation is on right now, for a machine's tile. */
export function LiveCall({ caseId }: { caseId: string | undefined }) {
  const live = useLiveRun(caseId);
  const steps = shownSteps(live?.steps ?? []);
  const pb = usePlayback(steps, { streaming: !live || live.streaming, quick: true, autoplay: true, runKey: caseId ?? "none" });
  const step = steps[pb.play.at];
  if (!step) return <>opening the case…</>;
  return (
    <>
      {step.agent === "critic" ? "the critic" : "the investigator"} calls <code>{step.tool}</code>
    </>
  );
}

/** The AI investigators' latest calls across this session's investigations. */
export function ActivityFeed() {
  const session = useSession();
  const calls = [...session.cases]
    .filter((c) => c.kind === "agents" && c.run)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5)
    .flatMap((c) =>
      turnsOf(c.run!)
        .flatMap((t) => t.calls)
        // Re-reading the case and narrating are not decisions; the feed shows the calls that moved the case.
        .filter((s) => s.kind === "asks" && s.tool !== "get_case")
        .slice(-2)
        .reverse()
        .map((s) => ({ ...s, caseId: c.id, machine: machineOfCase(c).short })),
    )
    .slice(0, 8);

  return (
    <Card title="Crux at work" icon={<Activity size={15} />} sub="its latest moves" flush>
      {calls.length === 0 ? (
        <Empty left icon={<Sparkles size={18} />} title="Nothing investigated yet">
          Each step Crux's AI investigators take shows up here, with the physics' answer to it.
        </Empty>
      ) : (
        <ul className="feed">
          {calls.map((s, i) => (
            <li key={i}>
              <span className={cx("feed-dot", s.agent)} aria-hidden />
              <div>
                <div className="row gap-1 row-wrap small">
                  <b>{s.machine}</b>
                  <code>{s.tool}</code>
                  <Link to={`/cases/${s.caseId}`} className="push mono dim">
                    {shortId(s.caseId)}
                  </Link>
                </div>
                <div className="muted small" style={{ marginTop: 2 }}>
                  {plainSentence(s.answered ?? s.asked)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
