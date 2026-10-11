// What Crux does not claim, in plain words. These are the limits a judge
// would otherwise have to find for themselves.

import { Section } from "../../ui/Section";
import s from "./Refusals.module.css";

const REFUSALS = [
  {
    claim: "That it is accurate on real machines.",
    why: "The 180 cases are synthetic, and no accuracy number on real recordings is shown until they have been run.",
  },
  {
    claim: "That a forecast is a promise.",
    why: "Time left is a range for planning, and today the truth falls inside it 42% of the time against an 80% aim.",
  },
  {
    claim: "That a camera finding is confirmed.",
    why: "What a camera or a model saw is marked unconfirmed until a person checks it.",
  },
  {
    claim: "That it can act on a machine.",
    why: "Crux recommends. A person decides and does the work.",
  },
];

export function Refusals() {
  return (
    <Section title="What Crux refuses to claim" id="proof-refuses">
      <ul className={s.list}>
        {REFUSALS.map((r) => (
          <li key={r.claim} className={s.item}>
            <strong>{r.claim}</strong> {r.why}
          </li>
        ))}
      </ul>
    </Section>
  );
}
