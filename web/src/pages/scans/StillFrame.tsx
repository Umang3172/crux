// One still from the clip, with what was drawn on it kept apart by whose it is:
// the box the physics measured (solid blue), and whatever a model boxed
// (dashed, labelled unconfirmed). Optionally the picture's shake grid, and, for
// the person confirming a scan, a way to move the measuring box.

import type { CSSProperties } from "react";
import { scanStillUrl } from "../../api/crux";
import type { Box } from "../../api/types";
import s from "./StillFrame.module.css";

export type Mark = { box: Box; kind: "measured" | "model" | "finding"; label: string };

type Props = {
  id: string;
  size: [number, number];
  index: number;
  alt: string;
  marks?: Mark[];
  /** Each cell's shaking against the median cell, laid over the area it covers. */
  shake?: { grid: number[][]; area: Box };
  /** A tap on the picture, as fractions of its width and height. */
  onPlace?: (x: number, y: number) => void;
  /** An arrow key, as a fraction of the picture. */
  onNudge?: (dx: number, dy: number) => void;
};

const NUDGE = 0.02;

export function StillFrame({ id, size, index, alt, marks = [], shake, onPlace, onNudge }: Props) {
  const [w, h] = size;
  return (
    <div className={s.frame} style={{ aspectRatio: `${w} / ${h}`, width: `min(100%, calc(70vh * ${w / h}))` }}>
      <img className={s.img} src={scanStillUrl(id, index)} alt={alt} decoding="async" />
      {shake && shake.grid.length > 0 && <ShakeGrid grid={shake.grid} area={shake.area} />}
      {marks.map((m, i) => (
        <div key={i} className={[s.mark, s[m.kind]].join(" ")} style={place(m.box)}>
          <span className={s.label}>{m.label}</span>
        </div>
      ))}
      {onPlace && (
        <button
          type="button"
          className={s.place}
          aria-label="Move the measuring box: tap the machine on the picture, or use the arrow keys"
          onClick={(e) => {
            // A click from the keyboard has no position to read.
            if (e.detail === 0) return;
            const r = e.currentTarget.getBoundingClientRect();
            onPlace((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
          }}
          onKeyDown={(e) => {
            const d = ARROWS[e.key];
            if (!d || !onNudge) return;
            e.preventDefault();
            onNudge(d[0], d[1]);
          }}
        />
      )}
    </div>
  );
}

const ARROWS: Record<string, [number, number] | undefined> = {
  ArrowLeft: [-NUDGE, 0],
  ArrowRight: [NUDGE, 0],
  ArrowUp: [0, -NUDGE],
  ArrowDown: [0, NUDGE],
};

const place = (b: Box): CSSProperties => ({
  left: `${b.x * 100}%`,
  top: `${b.y * 100}%`,
  width: `${b.w * 100}%`,
  height: `${b.h * 100}%`,
});

function ShakeGrid({ grid, area }: { grid: number[][]; area: Box }) {
  return (
    <div
      className={s.shake}
      style={{ ...place(area), gridTemplateColumns: `repeat(${grid[0]?.length ?? 1}, 1fr)`, gridTemplateRows: `repeat(${grid.length}, 1fr)` }}
      aria-hidden="true"
    >
      {grid.flat().map((v, i) => (
        // 1 is a typical cell; the grid reads a cell as shaking clearly from about 4.
        <span key={i} style={{ "--v": Math.min(1, Math.max(0, (v - 1) / 7)) } as CSSProperties} />
      ))}
    </div>
  );
}

/** A box on the 0..1000 scale models use, [ymin, xmin, ymax, xmax], as fractions of the frame. */
export function fromThousand(b: [number, number, number, number]): Box {
  const [ymin, xmin, ymax, xmax] = b;
  return { x: xmin / 1000, y: ymin / 1000, w: (xmax - xmin) / 1000, h: (ymax - ymin) / 1000 };
}
