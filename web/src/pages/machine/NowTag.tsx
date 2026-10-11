// The bearing now, as one tag hung on it: its class says whether the watcher
// has fired, the figures are the recording's own at the plant clock, and the
// forecast is labelled a forecast with how often such forecasts held.

import type { ReactNode } from "react";
import type { MachineReplay } from "../../api/types";
import { num } from "../../lib/format";
import { SourceTag } from "../../ui/SourceTag";
import { Field, Fields, Tag } from "../../ui/Tag";
import { isOverLine, type PartNow } from "./replay";
import { RiskInput } from "./RiskInput";
import { calibration, hourLabel, likelyText, rangeText } from "./words";
import s from "./NowTag.module.css";

const METHOD: Record<string, string> = {
  "gbm-residual": "learned from other bearings, never this one",
  trend: "trend fit",
};

export function NowTag({
  replay,
  focus,
  worst,
  synthetic,
  stopIn,
  onStopIn,
  children,
}: {
  replay: MachineReplay;
  focus: PartNow;
  worst: PartNow;
  synthetic: boolean;
  stopIn: string;
  onStopIn: (v: string) => void;
  children: ReactNode;
}) {
  const r = focus.range;
  const alarm = focus.part.alarm_h;
  return (
    <Tag tone={focus.alarmed ? "caution" : "safety"} head={focus.alarmed ? "Needs attention" : "Normal"} aria-label="This bearing at the plant clock">
      <div className={s.health}>
        <span className={s.big}>
          {Math.round(focus.percent)}
          <span className={s.sign}>%</span>
        </span>
        <span className={s.words}>
          <strong>{focus === worst ? "Health of the worst part" : `Health of ${focus.part.label.toLowerCase()}`}</strong>
          <span>This is not life left.</span>
        </span>
      </div>
      <Fields columns={2}>
        <Field label="Vibration">
          <span className={s.value}>{num(focus.level, 1)}× </span>its own normal
          <SourceTag>{synthetic ? "synthetic life" : "recorded run"}</SourceTag>
        </Field>
        <Field label="Alarm">{focus.alarmed && alarm !== null ? <span className={s.value}>{hourLabel(alarm)}</span> : "None yet"}</Field>
        <Field label="Fix within" wide>
          {!focus.alarmed || !r ? (
            "No forecast yet. Crux gives a range only after the alarm, never while a bearing looks healthy."
          ) : isOverLine(r) ? (
            "Already over the danger line."
          ) : (
            <span className={s.forecast}>
              <span className={s.range}>{rangeText(r)}</span>
              {likelyText(r) && <span>Most likely {likelyText(r)}.</span>}
              <SourceTag tone="measure">{`forecast · ${METHOD[focus.part.method] ?? focus.part.method}`}</SourceTag>
              <span className={s.caveat}>A forecast, not a measurement. {calibration(replay, synthetic)}</span>
            </span>
          )}
        </Field>
        <Field label="Risk before the next stop" wide>
          <RiskInput machine={replay.machine} part={focus.part.part} at={focus.alarmed && r ? r.at_h : null} value={stopIn} onChange={onStopIn} />
        </Field>
      </Fields>
      <div className={s.foot}>{children}</div>
    </Tag>
  );
}
