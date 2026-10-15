// The scoreboard: for each job, the method Crux runs beside the ones it was
// tested against, Google's included. Every cell is text from data/evaluation.ts,
// or the server's compressor benchmark formatted (trust/benchBoards.ts); the
// only thing read out of a cell is a percentage, to draw against its aim.

import { Terminal } from "lucide-react";
import { seriesBench } from "../../api/series";
import { BOARDS, FIXED_NORMAL, type Board, type BenchColumn, type BenchRow } from "../../data/evaluation";
import { useAsync } from "../../lib/hooks";
import { Badge, Card, Hint, Meter, SourceTag, cx } from "../../ui/kit";
import { benchBoards } from "./benchBoards";

const share = (s: string) => {
  const m = /^(\d+(?:\.\d+)?)%$/.exec(s.trim());
  return m ? Number(m[1]) / 100 : null;
};

function Cell({ text, col }: { text: string | null; col: BenchColumn }) {
  if (text === null) return <td className="t-num dim-cell">–</td>;
  const got = col.aim !== undefined ? share(text) : null;
  return (
    <td className="t-num">
      {got === null ? (
        text
      ) : (
        <span className="sb-aim">
          <span>{text}</span>
          <Meter value={got} mark={col.aim} />
        </span>
      )}
    </td>
  );
}

function Method({ row }: { row: BenchRow }) {
  return (
    <td>
      <span className="sb-method">
        <span className={cx(row.ships && "strong")}>{row.method}</span>
        {row.by === "google" && (
          <Badge tone="model" plain>
            Google
          </Badge>
        )}
        {row.ships && (
          <Badge tone="ok" dot>
            runs in Crux
          </Badge>
        )}
        {row.after && <Hint label="Why this row is not counted">{row.after}</Hint>}
      </span>
    </td>
  );
}

function BoardCard({ b }: { b: Board }) {
  return (
    <Card id={`bench-${b.id}`} title={b.job} actions={<SourceTag source={b.source} />} flush>
      <p className="sb-data">{b.data}</p>
      <div className="table-wrap">
        <table className="table compact sb-table">
          <thead>
            <tr>
              <th>Method</th>
              {b.columns.map((c) => (
                <th key={c.label} className="t-num" data-tip={c.tip}>
                  {c.label}
                  {c.aim !== undefined && <span className="sb-aim-label"> · aim {Math.round(c.aim * 100)}%</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r) => (
              <tr key={r.method} className={cx(r.ships && "sb-ships", r.after && "sb-after")}>
                <Method row={r} />
                {r.cells.map((c, i) => (
                  <Cell key={b.columns[i].label} text={c} col={b.columns[i]} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sb-foot">
        <p className="sb-verdict">{b.verdict}</p>
        {b.also && <p className="sb-also">{b.also}</p>}
        <p className="sb-run">
          <Terminal size={13} aria-hidden />
          <code>{b.run}</code>
        </p>
      </div>
    </Card>
  );
}

export function Scoreboard() {
  const bench = useAsync((sig) => seriesBench("metro", sig), []);
  const compressor = bench.data ? benchBoards(bench.data) : [];
  const leaks = compressor.find((b) => b.id === "compressor-leaks");
  if (leaks) leaks.also = FIXED_NORMAL;
  // The compressor's boards follow the bearing ones they compare with.
  const boards = [...BOARDS.slice(0, 2), ...compressor, ...BOARDS.slice(2)];
  return (
    <div className="col sb" style={{ gap: "var(--s-5)" }}>
      <div className="sb-lead">
        <h2>Each job uses the method that won its test.</h2>
        <p>
          Google's TimesFM wins the compressor's next-day forecast, where the signal repeats. On bearings heading for failure it forecast the damage levelling off, so
          time left runs on Crux's own model, and Crux's watcher noticed the compressor's leaks with fewer false alarms than TimesFM's check. The losing methods
          stay on the board.
        </p>
      </div>
      {boards.map((b) => (
        <BoardCard key={b.id} b={b} />
      ))}
    </div>
  );
}
