// Where a number came from, always beside it.

import s from "./SourceTag.module.css";

export type Source =
  | "physics model"
  | "virtual experiment"
  | "virtual instrument"
  | "person"
  | "live sensor"
  | "recorded run"
  | "model"
  | "synthetic";

export function SourceTag({ children, tone = "plain" }: { children: string; tone?: "plain" | "model" | "measure" }) {
  return <span className={[s.source, s[tone]].join(" ")}>{children}</span>;
}
