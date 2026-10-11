// A small titled block under the AI's conversation: a heavy rule, a short
// caps title, then its content. Not a card: no box, no fill.

import type { ReactNode } from "react";
import s from "./Block.module.css";

export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={s.block}>
      <h3 className={s.title}>{title}</h3>
      {children}
    </section>
  );
}
