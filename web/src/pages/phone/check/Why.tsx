// Why this check, in one line, from the suspects the engine says it can't
// separate (the request's `separates`).

import { fault } from "../../../lib/plain";
import s from "./Why.module.css";

export function Why({ separates }: { separates: string[] }) {
  const names = separates.map((k) => fault(k).name);
  const bold = (n: string) => <strong key={n}>{n}</strong>;
  let line;
  if (names.length === 2) {
    line = (
      <>
        Crux can't tell {bold(names[0])} from {bold(names[1])}
      </>
    );
  } else if (names.length > 2) {
    line = (
      <>
        Crux can't tell{" "}
        {names.map((n, i) => (
          <span key={n}>
            {i === 0 ? "" : i === names.length - 1 ? " and " : ", "}
            {bold(n)}
          </span>
        ))}{" "}
        apart
      </>
    );
  } else {
    line = <>Crux can't separate the suspects it has left</>;
  }
  return (
    <p className={s.why}>
      {line}; this reading decides between them.
    </p>
  );
}
