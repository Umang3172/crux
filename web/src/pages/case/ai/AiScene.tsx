// The pump, drawn at rest, and the tag the engine hangs on it once it has
// named a cause. This run has no measured vibration level, so the drawing
// does not shake; a part is marked only after a verdict.

import { useMemo, useState } from "react";
import type { CaseView } from "../../../api/types";
import { pct } from "../../../lib/format";
import { useReducedMotion } from "../../../lib/hooks";
import { fault } from "../../../lib/plain";
import { MachineScene } from "../../../ui/machine/MachineScene";
import { PumpDrawing } from "../../../ui/machine/PumpDrawing";
import { Field, Fields, Tag } from "../../../ui/Tag";
import { markedPart } from "./derive";
import s from "./AiScene.module.css";

const TAG_WIDTH = 360;

export function AiScene({ c }: { c: CaseView }) {
  const reduce = useReducedMotion();
  const [anchor, setAnchor] = useState({ x: 0.5, y: 0.5 });
  const part = markedPart(c);
  const bearing = !!part && part.startsWith("bearing");
  const named = c.status === "concluded";
  const healthy = c.leader === "healthy";
  const f = fault(c.leader);
  const suspect = c.suspects.find((x) => x.name === c.leader);

  // The scene's anchor sits on the drive-end bearing, so the string only runs
  // there when the named part is one of the bearing's.
  const left = useMemo(() => {
    const w = `min(${TAG_WIDTH}px, 100%)`;
    const x = bearing
      ? `clamp(0px, calc(${(anchor.x * 100).toFixed(2)}% - ${TAG_WIDTH / 2}px), calc(100% - ${w}))`
      : `calc((100% - ${w}) / 2)`;
    return { marginLeft: x, width: w };
  }, [anchor.x, bearing]);

  return (
    <div className={s.left}>
      <div className={s.sceneWrap}>
        <MachineScene
          className={s.scene}
          vibration={1}
          pattern="steady"
          highlight={part}
          openBearing={bearing}
          reduceMotion={reduce}
          onAnchor={bearing ? setAnchor : undefined}
          fallback={<PumpDrawing highlight={part} />}
          ariaLabel={part ? `The pump set with ${f.partName} marked` : "The pump set, with nothing marked"}
        />
        {named && bearing && (
          <span className={s.string} style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }} aria-hidden="true" />
        )}
      </div>
      {named && (
        <div className={bearing ? s.hung : s.free} style={left}>
          <Tag tone={healthy ? "safety" : "caution"} head={healthy ? "Normal" : "Inspect"} line={bearing} drop aria-label="The answer">
            <Fields columns={2}>
              <Field label="Cause" wide>
                {f.name}
              </Field>
              <Field label="Belief">{pct(c.leader_belief)}</Field>
              <Field label="Where">{healthy ? "Nothing to open" : f.partName}</Field>
              <Field label="Came from" wide>
                {suspect?.origin === "written" ? "Written by the AI, tested by the physics" : "Crux's own list of causes"}
              </Field>
            </Fields>
          </Tag>
        </div>
      )}
      <p className={s.caption}>
        {part ? `Marked: ${f.partName}. ` : "Nothing is marked: Crux has named no part. "}
        Drawn at rest: this run has no measured vibration level, so nothing is shaken.
      </p>
    </div>
  );
}
