// What the run used. The server reports rounds and the calls the tools made;
// it does not report seconds or model calls, so those appear only as caps.

import type { AgentAbout, AgentRun } from "../../../api/types";
import { Block } from "./Block";
import s from "./Limits.module.css";

export function Limits({ run, about }: { run: AgentRun; about: AgentAbout | null }) {
  const limits = about?.limits;
  return (
    <Block title="Limits used">
      <p>
        <b>{run.rounds}</b>
        {limits?.rounds ? ` of ${limits.rounds}` : ""} {run.rounds === 1 ? "round" : "rounds"} · <b>{run.tool_calls.length}</b>{" "}
        {run.tool_calls.length === 1 ? "tool call" : "tool calls"}
      </p>
      {!!limits?.model_calls && !!limits?.seconds && (
        <p className={s.quiet}>
          A run is also capped at {limits.model_calls} model calls and {limits.seconds} seconds. The server does not report how many of
          those this one used.
        </p>
      )}
      {run.stopped && <p className={s.stopped}>{run.stopped}</p>}
    </Block>
  );
}
