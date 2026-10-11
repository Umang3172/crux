// A titled block of a page. The heading carries its own weight: no label
// above it, no numbered prefix.

import type { ReactNode } from "react";
import s from "./Section.module.css";

export function Section({
  title,
  aside,
  children,
  id,
  className,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section className={[s.section, className].filter(Boolean).join(" ")} aria-labelledby={id}>
      <header className={s.head}>
        <h2 id={id} className={s.title}>
          {title}
        </h2>
        {aside && <div className={s.aside}>{aside}</div>}
      </header>
      {children}
    </section>
  );
}
