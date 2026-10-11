// The identity every machine page opens with: its name, what it is, where it
// stands, and beside it whatever says where its numbers come from.

import type { ReactNode } from "react";
import { PLANT_NAME } from "../../demo/stories";
import s from "./MachineHead.module.css";

export function MachineHead({ name, type, children }: { name: string; type: string; children?: ReactNode }) {
  return (
    <header className={s.head}>
      <div className={s.id}>
        <h1 className={s.title}>{name}</h1>
        <p className={s.sub}>
          {type} · {PLANT_NAME}
        </p>
      </div>
      {children && <div className={s.meta}>{children}</div>}
    </header>
  );
}
