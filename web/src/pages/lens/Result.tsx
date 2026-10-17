// The last screen: the machine drawn with what was found on it, and three short
// lines. The frame the model looked at sits beside them, with its boxes, so the
// red on the drawing can be checked against the clip. What was found is either
// a damage finding from the model's look, or a part that shakes clearly more
// than the rest of the frame, measured by code from the video's motion.

import { Link } from "react-router";
import { ArrowRight, RotateCcw } from "lucide-react";
import { scanStillUrl } from "../../api/crux";
import type { Finding, Scan } from "../../api/types";
import { PipeFigure } from "../../figures/pipe/PipeFigure";
import { partAt, partName } from "../../figures/pipe/model";
import { SkidFigure } from "../../figures/skid/SkidFigure";
import { PART_NAME, partAtPoint, partOf } from "../../figures/skid/model";
import { PumpsetFigure } from "../../figures/pumpset/PumpsetFigure";
import * as pumpset from "../../figures/pumpset/model";
import { Badge, Button } from "../../ui/kit";
import type { DemoClip } from "./demo";
import { modelName } from "./pipeline";

const WORD: Record<Finding["item"], string> = {
  crack: "Crack",
  leak: "Leak",
  corrosion: "Corrosion",
  belt: "Belt problem",
  heat: "Heat marks",
  loose: "Loose or missing part",
  smoke: "Smoke",
};

const damage = (f: Finding) => f.item === "leak" || f.item === "crack" || f.item === "loose" || f.item === "smoke";

/** A part shakes clearly more than the rest of the frame: the motion check's own bar (MAP_PROMINENCE, docs/LENS.md). */
const SHAKE_BAR = 4;

type Shake = { ratio: number; at: [number, number] };

/**
 * The shaking the motion check measured: the strongest cell's ratio over the
 * median cell, and where the cells over the bar sit, weighted by how much each
 * shakes, as frame fractions. Null when no part clears the bar.
 */
function shakeOf(scan: Scan): Shake | null {
  const a = scan.shake_area;
  const rows = scan.shake.length;
  const cols = scan.shake[0]?.length ?? 0;
  if (!a || !rows || !cols) return null;
  let ratio = 0;
  let sum = 0;
  let x = 0;
  let y = 0;
  scan.shake.forEach((row, r) =>
    row.forEach((v, c) => {
      ratio = Math.max(ratio, v);
      if (v < SHAKE_BAR) return;
      sum += v;
      x += v * (a.x + ((c + 0.5) / cols) * a.w);
      y += v * (a.y + ((r + 0.5) / rows) * a.h);
    }),
  );
  return sum ? { ratio, at: [x / sum, y / sum] } : null;
}

const times = (r: number) => `${r < 10 ? r.toFixed(1) : r.toFixed(0)}×`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The frame the model looked at, with each box it drew and the part that shakes most. */
export function StillWithBoxes({ scan, findings }: { scan: Scan; findings: Finding[] }) {
  const shake = scan.box_source === "where the video shakes most" ? scan.box : null;
  return (
    <figure className="ll-still">
      <div className="ll-still-frame">
        <img src={scanStillUrl(scan.id, Math.floor(scan.stills / 2))} alt={`The frame the model looked at, from scan ${scan.id}`} />
        {findings
          .filter((f) => f.box)
          .map((f, i) => {
            const [y0, x0, y1, x1] = f.box!;
            return (
              <span
                key={`${f.item}-${i}`}
                className="ll-box"
                data-tone={damage(f) ? "danger" : "warn"}
                data-inside={y0 < 60 ? "" : undefined}
                style={{ left: `${x0 / 10}%`, top: `${y0 / 10}%`, width: `${(x1 - x0) / 10}%`, height: `${(y1 - y0) / 10}%` }}
              >
                <b>{f.item}</b>
              </span>
            );
          })}
        {shake && (
          <span
            className="ll-box"
            data-tone={findings.some(damage) ? "warn" : "danger"}
            data-inside={shake.y < 0.06 ? "" : undefined}
            style={{ left: `${shake.x * 100}%`, top: `${shake.y * 100}%`, width: `${shake.w * 100}%`, height: `${shake.h * 100}%` }}
          >
            <b>shakes</b>
          </span>
        )}
      </div>
      <figcaption className="tiny dim">What the model looked at, and where the video shakes</figcaption>
    </figure>
  );
}

export function Result({ scan, clip, onAgain, forCase }: { scan: Scan; clip: DemoClip | null; onAgain: () => void; forCase?: string }) {
  const look = "findings" in scan.look ? scan.look : null;
  const findings = look?.findings ?? [];
  const main = findings.find(damage) ?? findings[0];
  const shake = shakeOf(scan);
  const drawing = clip?.drawing ?? null;
  const shakePart = shake && drawing === "skid" ? partAtPoint(...shake.at) : null;
  const setShakePart = shake && drawing === "pumpset" ? pumpset.partAtPoint(...shake.at) : null;
  const shakeWhere = shakePart ? PART_NAME[shakePart] : setShakePart ? pumpset.PART_NAME[setShakePart] : "";
  const skidPart = drawing === "skid" ? (main ? partOf(main) : shakePart) : null;
  const setPart = drawing === "pumpset" ? (main ? pumpset.partOf(main) : setShakePart) : null;
  const where = !main
    ? ""
    : drawing === "pipe"
      ? partName(partAt(main.box))
      : skidPart
        ? PART_NAME[skidPart]
        : setPart
          ? pumpset.PART_NAME[setPart]
          : main.where;
  const others = findings.filter((f) => f !== main).map((f) => WORD[f.item].toLowerCase());
  const model = look ? modelName(look.inspected_by).replace(" · runs code", "") : "The model";
  const moves = shake ? `${shakeWhere ? cap(shakeWhere) : "One part"} moves ${times(shake.ratio)} more than the rest of the frame` : "";

  const title = main ? `${WORD[main.item]}${where ? ` at ${where}` : ""}` : shake ? `Shaking${shakeWhere ? ` at ${shakeWhere}` : ""}` : "Nothing plainly wrong seen";
  const readout = main ? `${main.item} · ${main.severity} · kept after a second look` : shake ? `moves ${times(shake.ratio)} the rest` : "nothing seen on the clip";

  return (
    <div className="ll-result">
      <div className="ll-art">
        {drawing === "pipe" ? (
          <PipeFigure findings={findings} compact />
        ) : drawing === "skid" ? (
          <SkidFigure part={skidPart} shakes={shake !== null} readout={readout} />
        ) : drawing === "pumpset" ? (
          <PumpsetFigure part={setPart} shakes={shake !== null} readout={readout} />
        ) : (
          <StillWithBoxes scan={scan} findings={findings} />
        )}
      </div>

      <div className="ll-about">
        <div className="ll-say">
          <div className="row gap-2 row-wrap">
            <h2 className="ll-title">{title}</h2>
            {(main || shake) && <Badge tone="warn">unconfirmed</Badge>}
          </div>
          {main ? (
            <p className="ll-line">
              {model} saw it, then confirmed it on a close-up
              {others.length ? `; also ${others.join(", ")}` : ""}.{moves ? ` ${moves}.` : ""}
            </p>
          ) : shake ? (
            <p className="ll-line">
              {moves}, measured by code from the video. {look ? `${model} saw nothing else wrong on the still.` : ""}
            </p>
          ) : null}
          <p className="ll-line dim">
            {main ? "A person checks it by eye. A camera finding never changes the diagnosis." : shake ? "Confirm the shaft speed under Details, and Crux tests this shake against each fault." : "A person still walks the machine; a clean clip is not a clean bill."}
          </p>
          <div className="row gap-2 row-wrap ll-actions">
            <Button size="sm" icon={<RotateCcw size={13} />} onClick={onAgain}>
              Scan again
            </Button>
            <Link className="ll-open small" to={forCase ? `/lens/${scan.id}?case=${encodeURIComponent(forCase)}` : `/lens/${scan.id}`}>
              {forCase ? "Confirm the speed and answer the investigation" : "Details"} <ArrowRight size={12} aria-hidden />
            </Link>
          </div>
        </div>
        {drawing !== null && <StillWithBoxes scan={scan} findings={findings} />}
      </div>
    </div>
  );
}
