// One recorded run on the machine page: the chart and the plant clock on the
// left, and on the right the bearing now as a tag, with what a person can do
// about it. The chart shows only what happened before the clock.

import { useEffect, useMemo, useRef, useState } from "react";
import type { MachineReplay, MachineSummary } from "../../api/types";
import { useWorld } from "../../demo/world";
import { useReducedMotion } from "../../lib/hooks";
import { Button } from "../../ui/Button";
import { Section } from "../../ui/Section";
import { SourceTag } from "../../ui/SourceTag";
import { ChartKey } from "./ChartKey";
import { ClockBar } from "./ClockBar";
import { readClock, writeClock } from "./clock";
import { InvestigateResult } from "./InvestigateResult";
import { LifeChart } from "./LifeChart";
import { MachineHead } from "./MachineHead";
import { NowTag } from "./NowTag";
import { PartPicker } from "./PartPicker";
import { RecordingActions } from "./RecordingActions";
import { chartDomain, defaultNow, defaultPart, lastOf, partAt, startOf, stepOf, worstPart, type Zoom } from "./replay";
import { RunPicker } from "./RunPicker";
import { Truth } from "./Truth";
import { usePlantClock } from "./usePlantClock";
import { useRecordingActions, workOrderTitle } from "./useRecordingActions";
import s from "./LifeBody.module.css";

export function LifeBody({
  name,
  type,
  replay,
  list,
  synthetic,
  notice,
  guided,
  onPickRun,
}: {
  name: string;
  type: string;
  replay: MachineReplay;
  list: MachineSummary[];
  synthetic: boolean;
  /** Said when the recording asked for is not on this server. */
  notice: string | null;
  /** The visitor arrived from the demo guide: say what to press. */
  guided: boolean;
  onPickRun: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  const world = useWorld();
  const home = useMemo(() => defaultNow(replay), [replay]);
  const last = useMemo(() => lastOf(replay), [replay]);
  const step = useMemo(() => stepOf(replay), [replay]);
  const [initial] = useState(() => {
    const kept = readClock(replay.machine);
    return kept !== null && kept >= startOf(replay) && kept <= last ? kept : home;
  });
  const stops = useMemo(() => replay.parts.map((p) => p.alarm_h).filter((a): a is number => a !== null).sort((a, b) => a - b), [replay]);
  const clock = usePlantClock({ initial, home, step, last, stops });
  const [zoom, setZoom] = useState<Zoom>("final");
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [stopIn, setStopIn] = useState("1");

  // The plant's bearing tile reads the same clock, so it is kept when the clock rests and when the page closes.
  const latest = useRef(clock.now);
  latest.current = clock.now;
  useEffect(() => {
    if (!clock.playing) writeClock(replay.machine, clock.now);
  }, [clock.playing, clock.now, replay.machine]);
  useEffect(() => () => writeClock(replay.machine, latest.current), [replay.machine]);

  const parts = useMemo(() => replay.parts.map((p) => partAt(p, clock.now)), [replay, clock.now]);
  const worst = worstPart(parts);
  const focusId = picked ?? defaultPart(replay).part;
  const focus = parts.find((p) => p.part.part === focusId) ?? worst;
  const domain = chartDomain(replay, zoom, clock.now);

  const { inquiry, drafting, investigate, draft } = useRecordingActions({ replay, part: focus.part, atH: clock.now, stopIn, pause: clock.pause });
  const title = workOrderTitle(replay, focus.part);
  const existing = world.workOrders.find((w) => w.kind === "ticket" && w.title === title && w.stage !== "closed");

  return (
    <div className={s.page}>
      <MachineHead name={name} type={type}>
        <SourceTag>{synthetic ? "Synthetic pump life · physics model" : "Recorded run"}</SourceTag>
        <span>{replay.name}</span>
        <span>Bearing {replay.bearing}</span>
      </MachineHead>
      <div className={s.runline}>
        <RunPicker list={list} value={replay.machine} onPick={onPickRun} />
        {notice && <p className={s.notice}>{notice}</p>}
      </div>
      <div className={s.grid}>
        <div className={s.left}>
          <Section title="Life so far" aside="Only what Crux knew by the clock">
            {guided && !focus.alarmed && <p className={s.hint}>Press Play. The clock stops when the alarm fires, and the forecast starts there.</p>}
            <LifeChart replay={replay} parts={parts} focusId={focus.part.part} now={clock.now} domain={domain} revealed={revealed} reduceMotion={reduce} />
            <ClockBar
              clock={clock}
              min={zoom === "final" ? domain[0] : startOf(replay)}
              max={last}
              zoom={zoom}
              onZoom={setZoom}
              atEnd={clock.now >= last}
              extra={
                <Button onClick={() => setRevealed((v) => !v)} aria-pressed={revealed}>
                  {revealed ? "Hide what really happened" : "Show what really happened"}
                </Button>
              }
            />
            <ChartKey revealed={revealed} />
          </Section>
          {revealed && <Truth focus={focus} />}
        </div>
        <div className={s.right}>
          <PartPicker parts={parts} focusId={focus.part.part} onPick={setPicked} />
          <NowTag replay={replay} focus={focus} worst={worst} synthetic={synthetic} stopIn={stopIn} onStopIn={setStopIn}>
            <RecordingActions alarmed={focus.alarmed} inquiry={inquiry} drafting={drafting} existing={existing} onInvestigate={investigate} onDraft={draft} />
          </NowTag>
          {inquiry.phase === "done" && <InvestigateResult verdict={inquiry.verdict} atH={inquiry.atH} partLabel={focus.part.label} synthetic={synthetic} />}
        </div>
      </div>
    </div>
  );
}
