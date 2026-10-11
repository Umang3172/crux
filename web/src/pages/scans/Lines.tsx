// The shaft lines the physics looked for, one row each: where the camera sees
// them and how far the housing moves there.

import type { ScanAnalysis } from "../../api/types";
import { hz, orderText, px } from "./words";
import s from "./Lines.module.css";

export function Lines({ lines }: { lines: ScanAnalysis["lines"] }) {
  return (
    <table className={s.table}>
      <caption className="visually-hidden">Shaft lines: where the camera sees each and how far the housing moves there</caption>
      <thead>
        <tr>
          <th scope="col">Line</th>
          <th scope="col">Seen at</th>
          <th scope="col">Movement</th>
          <th scope="col">Note</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.order} className={l.clear ? undefined : s.dim}>
            <th scope="row">{orderText(l.order)}</th>
            <td>{hz(l.seen_hz)}</td>
            <td>{px(l.amp)}</td>
            <td className={s.note}>
              {Math.abs(l.true_hz - l.seen_hz) > 0.05 && `Really ${hz(l.true_hz)}, folded back by the frame rate. `}
              {!l.clear && "Can't be read by itself."}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
