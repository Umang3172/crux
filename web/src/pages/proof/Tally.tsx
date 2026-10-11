// A tally of cases, one cell per case, grouped by what happened to it. It is a
// count and nothing more: the cells are not individual cases in any order.
// Meaning never rests on colour alone: a right answer after a check carries
// the blue measurement dot, a "can't tell" is punched, and a wrong answer is
// struck through.

import s from "./Tally.module.css";

export type TallyKind = "right" | "check" | "void" | "wrong";
export type TallyGroup = { kind: TallyKind; count: number; label: string };

const ROWS = 6;
const CELL = 12;
const GAP = 3;
const STEP = CELL + GAP;
const MID = CELL / 2;

/** The mark inside one cell. */
function Mark({ kind }: { kind: TallyKind }) {
  if (kind === "check") {
    return (
      <>
        <circle className={s.ring} cx={MID} cy={MID} r="3.7" />
        <circle className={s.dot} cx={MID} cy={MID} r="2.2" />
      </>
    );
  }
  if (kind === "void") return <circle className={s.ring} cx={MID} cy={MID} r="2.4" />;
  if (kind === "wrong") return <path className={s.strike} d={`M2 ${CELL - 2}L${CELL - 2} 2`} />;
  return null;
}

function Cells({ kind, count }: { kind: TallyKind; count: number }) {
  const cols = Math.max(1, Math.ceil(count / ROWS));
  const width = cols * STEP - GAP;
  const height = ROWS * STEP - GAP;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className={s.cells}>
      {count === 0 ? (
        <rect className={s.none} x="0.5" y="0.5" width={CELL - 1} height={CELL - 1} />
      ) : (
        Array.from({ length: count }, (_, i) => (
          <g key={i} transform={`translate(${Math.floor(i / ROWS) * STEP} ${(i % ROWS) * STEP})`}>
            <rect className={s[kind]} width={CELL} height={CELL} />
            <Mark kind={kind} />
          </g>
        ))
      )}
    </svg>
  );
}

/** A small key cell, for a label that names one of the marks. */
export function Swatch({ kind }: { kind: TallyKind }) {
  return (
    <svg width={CELL} height={CELL} viewBox={`0 0 ${CELL} ${CELL}`} aria-hidden="true" className={s.swatch}>
      <rect className={s[kind]} width={CELL} height={CELL} />
      <Mark kind={kind} />
    </svg>
  );
}

export function Tally({ groups, label }: { groups: TallyGroup[]; label: string }) {
  return (
    <div className={s.tally} role="img" aria-label={label}>
      {groups.map((g) => (
        <div key={g.kind} className={s.group}>
          <p className={s.caption}>
            <strong>{g.count}</strong> {g.label}
          </p>
          <Cells kind={g.kind} count={g.count} />
        </div>
      ))}
    </div>
  );
}
