// A work order for the demo pump lives in the browser that drafted it, so a
// phone cannot open it. Say so, and say what does work from a phone.

import { Empty } from "../../../ui/States";
import s from "./Elsewhere.module.css";

export function Elsewhere({ id }: { id: string }) {
  return (
    <Empty title="This work order lives on the laptop">
      <div className={s.stack}>
        <p>
          Work orders for the demo pump are kept in the browser that drafted them, so this phone can't open {id}. Open it on that laptop and say what was found there.
        </p>
        <p>A work order drafted from a forecast on a recorded run has a ticket number starting with T-. The server keeps those, so any device can open them.</p>
      </div>
    </Empty>
  );
}
