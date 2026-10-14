// One square per case. Squares fill column by column, ten to a column, so two
// charts of the same total line up and a difference in a count shows as a
// difference in length. Each outcome has a shape as well as a colour: a
// declined case is hollow and a wrong one is crossed, so the picture reads
// without colour too.

import { useState, type CSSProperties } from "react";
import { cx } from "../../ui/kit";

export type UnitTone = "ok" | "accent" | "declined" | "danger";
export type UnitPart = { id: string; label: string; count: number; tone: UnitTone };

const ROWS = 10;
const SIZE = 16;
const PITCH = 20;

function Key({ tone }: { tone: UnitTone }) {
  return <i className={cx("tr-swatch", `t-${tone}`)} aria-hidden />;
}

export function UnitChart({ parts, on, label, lag = 0 }: { parts: UnitPart[]; on: boolean; label: string; lag?: number }) {
  const [hot, setHot] = useState<string | null>(null);
  const cells: { part: UnitPart; i: number }[] = [];
  for (const p of parts) for (let k = 0; k < p.count; k++) cells.push({ part: p, i: cells.length });
  const cols = Math.max(1, Math.ceil(cells.length / ROWS));
  const w = cols * PITCH - (PITCH - SIZE);
  const h = ROWS * PITCH - (PITCH - SIZE);

  return (
    <figure className={cx("tr-unit", on && "on", hot && "has-hot")} style={{ "--lag": `${lag}ms` } as CSSProperties}>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.count}`).join(", ")}`}>
        {cells.map(({ part, i }) => {
          const x = Math.floor(i / ROWS) * PITCH;
          const y = (i % ROWS) * PITCH;
          return (
            <g
              key={i}
              className={cx("tr-cell", `t-${part.tone}`, hot === part.id && "hot")}
              style={{ "--i": i } as CSSProperties}
              onPointerEnter={() => setHot(part.id)}
              onPointerLeave={() => setHot(null)}
            >
              <title>{`${part.label}: ${part.count}`}</title>
              <rect x={x} y={y} width={SIZE} height={SIZE} rx={3} />
              {part.tone === "danger" && <path className="tr-cross" d={`M${x + 5} ${y + 5}L${x + 11} ${y + 11}M${x + 11} ${y + 5}L${x + 5} ${y + 11}`} />}
            </g>
          );
        })}
      </svg>
      <figcaption className="tr-keys">
        {parts.map((p) => (
          <span
            key={p.id}
            className={cx("tr-key", hot === p.id && "hot", p.count === 0 && "zero")}
            tabIndex={0}
            onPointerEnter={() => setHot(p.id)}
            onPointerLeave={() => setHot(null)}
            onFocus={() => setHot(p.id)}
            onBlur={() => setHot(null)}
          >
            <Key tone={p.tone} />
            {p.label}
            <b className="num">{p.count}</b>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** A short row of squares for a small count: the same marks as the large chart. */
export function UnitRow({ parts, label }: { parts: UnitPart[]; label: string }) {
  return (
    <span className="tr-unitrow" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.count}`).join(", ")}`}>
      {parts.flatMap((p) => Array.from({ length: p.count }, (_, k) => <Key key={`${p.id}-${k}`} tone={p.tone} />))}
    </span>
  );
}
