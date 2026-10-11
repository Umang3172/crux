// Alerts other sites sent, as the server reported them on the last check. The
// server's status leaves applied alerts out, so before a check there is nothing
// to list, and nothing is made up to fill the space.

import { Tag } from "../../ui/Tag";
import type { Check } from "./useFleet";
import { scrub } from "./words";
import s from "./Alerts.module.css";

export function Alerts({ check }: { check: Check }) {
  if (check.state === "nohub") return <p className={s.note}>This server has no hub, so no alerts reach it.</p>;
  if (check.state !== "done") {
    return (
      <p className={s.note}>
        Alerts arrive when you check for updates. The server doesn't keep a list of the alerts it has already applied, so only the ones a
        check brings in during this visit show here. Their lessons are in the library below.
      </p>
    );
  }
  if (check.alerts.length === 0 && check.rejected.length === 0) {
    return <p className={s.note}>The last check brought no new alerts.</p>;
  }
  return (
    <ul className={s.list}>
      {check.alerts.map((a) => (
        <li key={`a${a.version}`}>
          <Tag tone="caution" head="Alert" size="rack" as="div">
            <span className={s.title}>Version {a.version}, applied to this site's memory</span>
            {a.lessons.length > 0 ? (
              <ul className={s.lessons}>
                {a.lessons.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            ) : (
              <span className={s.quiet}>It carried no new lessons.</span>
            )}
          </Tag>
        </li>
      ))}
      {check.rejected.map((r) => (
        <li key={`r${r.version}`}>
          <Tag tone="void" head="Refused" size="rack" as="div">
            <span className={s.title}>Version {r.version} did not check out</span>
            <span className={s.quiet}>{scrub(r.why) || "Its signature or its files did not match."} Nothing from it was used.</span>
          </Tag>
        </li>
      ))}
    </ul>
  );
}
