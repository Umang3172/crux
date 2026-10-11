// The floor pages: one column, big targets, readable on a bright factory
// floor and usable one-handed.

import type { ReactNode } from "react";
import { HazardBanner } from "./HazardBanner";
import s from "./PhoneShell.module.css";

export function PhoneShell({ children }: { children: ReactNode }) {
  return (
    <div className={s.phone}>
      <HazardBanner />
      <header className={s.header}>
        <span className={s.word}>Crux</span>
        <span className={s.where}>On the floor</span>
      </header>
      <main className={s.main}>{children}</main>
    </div>
  );
}
