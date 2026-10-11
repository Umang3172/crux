// Other results that were measured, each with the data it came from. Two are
// on real recordings, and one of those falls short of its aim; it is here
// because it does.

import { Section } from "../../ui/Section";
import { SourceTag } from "../../ui/SourceTag";
import s from "./Measured.module.css";

const ITEMS = [
  {
    key: "off-list",
    figure: "24",
    of: "of 24",
    what: "A fault that isn't on Crux's list: a damaged rolling element, fed to the synthetic rig on 24 different captures. The offline stand-in investigator wrote the missing suspect and the physics concluded on it every time.",
    source: "synthetic rig · offline stand-in",
  },
  {
    key: "watcher",
    figure: "14",
    of: "of 15",
    what: "XJTU-SY bearings where the watcher fired before the bearing failed. The one it missed failed in its cage.",
    source: "real recordings · XJTU-SY",
  },
  {
    key: "time-left",
    figure: "42%",
    of: "aim 80%",
    what: "How often the true time left fell inside the range Crux gives, against the 80% it aims for. The ranges are too narrow, so a forecast is a planning aid, not a promise. Each time one bearing was held out; 14 were scored.",
    source: "real recordings · XJTU-SY",
  },
];

export function Measured() {
  return (
    <Section title="Other measured results" id="proof-measured">
      <ul className={s.list}>
        {ITEMS.map((i) => (
          <li key={i.key} className={s.item}>
            <p className={s.figure}>
              <span className={s.n}>{i.figure}</span>
              <span className={s.of}>{i.of}</span>
            </p>
            <div className={s.copy}>
              <p>{i.what}</p>
              <SourceTag>{i.source}</SourceTag>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
