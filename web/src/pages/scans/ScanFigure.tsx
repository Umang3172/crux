// The clip's stills with what was drawn on them, kept apart by whose it is.
// The blue box is where the physics measured; dashed boxes were drawn by a
// model and are labelled unconfirmed. For a scan not yet analysed, the person
// can move the measuring box before the physics runs.

import { useState } from "react";
import { scanStillUrl } from "../../api/crux";
import type { Box, Scan } from "../../api/types";
import { fromThousand, StillFrame, type Mark } from "./StillFrame";
import { lookedBy, lookOf } from "./words";
import s from "./ScanFigure.module.css";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function ScanFigure({ scan, box, onBox }: { scan: Scan; box: Box; onBox?: (b: Box) => void }) {
  const [index, setIndex] = useState(Math.min(Math.floor(scan.stills / 2), Math.max(0, scan.stills - 1)));
  const [showShake, setShowShake] = useState(false);
  const [showModel, setShowModel] = useState(true);

  const look = lookOf(scan);
  const model = lookedBy(scan.identity.by);
  const modelMarks: Mark[] = [];
  if (scan.identity.box) {
    modelMarks.push({ box: scan.identity.box, kind: "model", label: `${scan.identity.box_label || "Machine"}: ${model ?? "a model"}, unconfirmed` });
  }
  for (const f of look.findings ?? []) {
    if (f.box) modelMarks.push({ box: fromThousand(f.box), kind: "finding", label: `${f.what}: unconfirmed` });
  }
  const marks: Mark[] = [{ box, kind: "measured", label: "Measured here" }, ...(showModel ? modelMarks : [])];
  const canShake = scan.shake.length > 0 && scan.shake_area !== null;

  if (scan.stills === 0) return null;
  return (
    <figure className={s.figure}>
      <StillFrame
        id={scan.id}
        size={scan.size}
        index={index}
        alt={`Still ${index + 1} of ${scan.stills} from the clip of ${scan.machine}`}
        marks={marks}
        shake={showShake && canShake && scan.shake_area ? { grid: scan.shake, area: scan.shake_area } : undefined}
        onPlace={
          onBox
            ? (x, y) => onBox({ ...box, x: clamp(x - box.w / 2, 0, 1 - box.w), y: clamp(y - box.h / 2, 0, 1 - box.h) })
            : undefined
        }
        onNudge={onBox ? (dx, dy) => onBox({ ...box, x: clamp(box.x + dx, 0, 1 - box.w), y: clamp(box.y + dy, 0, 1 - box.h) }) : undefined}
      />

      {scan.stills > 1 && (
        <div className={s.thumbs} role="group" aria-label="Stills from the clip">
          {Array.from({ length: scan.stills }, (_, i) => (
            <button key={i} type="button" className={s.thumb} aria-pressed={i === index} onClick={() => setIndex(i)}>
              <img src={scanStillUrl(scan.id, i)} alt={`Still ${i + 1}`} loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      )}

      <div className={s.switches}>
        {canShake && (
          <label className={s.switch}>
            <input type="checkbox" checked={showShake} onChange={(e) => setShowShake(e.target.checked)} />
            Show where the picture shakes
          </label>
        )}
        {modelMarks.length > 0 && (
          <label className={s.switch}>
            <input type="checkbox" checked={showModel} onChange={(e) => setShowModel(e.target.checked)} />
            Show what the model boxed
          </label>
        )}
      </div>

      <figcaption className={s.caption}>
        <span className={s.key}>
          <i className={s.measured} aria-hidden="true" /> Blue: where the physics measured, taken from {scan.box_source}.
        </span>
        {modelMarks.length > 0 && showModel && (
          <span className={s.key}>
            <i className={s.dashed} aria-hidden="true" /> Dashed: drawn by a model, unconfirmed.
          </span>
        )}
        {onBox && <span className={s.key}>Tap the machine on the picture to move the box.</span>}
      </figcaption>
    </figure>
  );
}
