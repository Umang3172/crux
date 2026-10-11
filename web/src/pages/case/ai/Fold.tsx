// A ruled row that opens in place. Native <details>, so the keyboard, the
// focus and find-in-page all work without anything re-built.

import type { ReactNode } from "react";
import { Icon } from "../../../ui/Icon";
import s from "./Fold.module.css";

export function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className={s.fold}>
      <summary className={s.summary}>
        <span className={s.title}>{title}</span>
        <Icon name="chevron-down" size={20} />
      </summary>
      <div className={s.inner}>{children}</div>
    </details>
  );
}
