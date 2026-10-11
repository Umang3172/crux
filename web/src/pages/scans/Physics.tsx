// What the physics found in the clip. These are the engine's words and
// numbers: the housing's motion, measured, against what each fault would do.
// Nothing a model said is mixed in here.

import type { ReactNode } from "react";
import type { ScanAnalysis } from "../../api/types";
import { num, rpm } from "../../lib/format";
import { Agreement } from "./Agreement";
import { Change } from "./Change";
import { Lines } from "./Lines";
import { Spectrum } from "./Spectrum";
import { directionWords, fps, kindLabel, physicsSentences, px, upperFirst } from "./words";
import s from "./Physics.module.css";

export function Physics({ analysis }: { analysis: ScanAnalysis }) {
  const sentences = physicsSentences(analysis);
  const standing = analysis.standing;
  return (
    <div className={s.wrap}>
      <ul className={s.sentences}>
        {sentences.map((t, i) => (
          <li key={t} className={i === 0 ? s.lead : undefined}>
            {t}
          </li>
        ))}
      </ul>

      <dl className={s.readings}>
        <div>
          <dt>Shaft speed</dt>
          <dd className={s.big}>{rpm(analysis.rpm)}</dd>
          <dd className={s.note}>{upperFirst(analysis.speed_note)}.</dd>
        </div>
        <div>
          <dt>Camera</dt>
          <dd className={s.big}>{fps(analysis.fps)}</dd>
          <dd className={s.note}>It can see motion up to {num(analysis.fps / 2, 0)} Hz; faster lines fold back.</dd>
        </div>
        <div>
          <dt>Typical movement</dt>
          <dd className={s.big}>{px(analysis.rms_px)}</dd>
          <dd className={s.note}>
            Of the housing, {directionWords(analysis.direction_deg)}, in the picture's pixels, inside a box {num(analysis.scale_px, 0)} px across
            corner to corner.
          </dd>
        </div>
      </dl>

      <Block title="How the housing shakes">
        <Spectrum spectrum={analysis.spectrum} lines={analysis.lines} />
        <Lines lines={analysis.lines} />
      </Block>

      <div className={s.pair}>
        <Block title="Which fault the motion matches">
          <Agreement scores={analysis.camera} standing={standing} label="Agreement of each fault's simulated motion with the measured motion" />
          <p className={s.note}>
            Agreement is 1 for the same pattern. Still possible: {standing.map(kindLabel).join(", ") || "nothing listed"}.
          </p>
          {analysis.camera_blind && (
            <p className={s.note}>At this frame rate the camera can't separate the shaft lines, so it says nothing between these faults.</p>
          )}
        </Block>
        <Block title="Against the normal scan">
          <Change analysis={analysis} />
        </Block>
      </div>

      <Block title="Sound">
        {analysis.sound.length > 0 && (
          <Agreement scores={analysis.sound} standing={standing} label="Agreement of each fault's simulated sound with the recorded sound" />
        )}
        <p className={s.note}>{upperFirst(analysis.sound_note)}.</p>
      </Block>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={s.block}>
      <h3 className={s.h}>{title}</h3>
      {children}
    </section>
  );
}
