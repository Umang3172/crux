// Who decides what, in three ruled rows. The rule above each row is the same
// one the case page uses for that voice: solid ink for the physics, dashed for
// the AI, a plain hairline for people.

import s from "./Roles.module.css";

const ROLES = [
  {
    id: "physics",
    name: "Physics decides",
    text: "Every belief. Crux simulates each possible cause on a virtual copy of the machine, scores it against what was measured, and names a cause only when its belief passes the bar. The same case gives the same numbers every time.",
    never: "guess, or count a model's confidence as evidence.",
  },
  {
    id: "ai",
    name: "The AI proposes, explains and drafts",
    text: "It can write a suspect the list lacks, look things up in the machine's documents, put the answer into plain words and draft the work order. Whatever it writes carries the name of what wrote it.",
    never: "move a belief, score a suspect or take a reading.",
  },
  {
    id: "people",
    name: "People measure, approve and repair",
    text: "A person takes the one check, approves the work order by name and does the repair. Crux recommends; nothing here sends a command to a machine.",
    never: null,
  },
] as const;

export function Roles() {
  return (
    <ul className={s.roles}>
      {ROLES.map((r) => (
        <li key={r.id} className={[s.role, s[r.id]].join(" ")}>
          <h3 className={s.name}>{r.name}</h3>
          <div className={s.copy}>
            <p className={s.text}>{r.text}</p>
            {r.never && (
              <p className={s.never}>
                <b>Never</b> {r.never}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
