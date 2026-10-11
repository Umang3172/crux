// The suspects the AI proposed and what became of each: kept (the physics
// tested it), refused (and why), or waiting to be tested.

import { pct } from "../../../lib/format";
import { Block } from "./Block";
import { sentence, type Proposal } from "./derive";
import s from "./Written.module.css";

const OUTCOME: Record<Proposal["outcome"], string> = { kept: "Kept", refused: "Refused", queued: "Waiting" };

function detail(p: Proposal): string {
  if (p.outcome === "refused") return p.said.replace(/^Refused\.?\s*/i, "") || "The physics refused it before it could be tested.";
  if (p.outcome === "queued") return "Added. It will be simulated with the rest.";
  const belief = p.belief === null ? "not scored yet" : `belief ${pct(p.belief)}`;
  return `Simulated and scored on all the evidence: ${belief}${p.ruledOut ? ", so it is ruled out" : ""}.`;
}

export function Written({ proposals }: { proposals: Proposal[] }) {
  return (
    <Block title="Suspects the AI wrote">
      {proposals.length === 0 ? (
        <p className={s.quiet}>None. Every suspect on the rack came from Crux's own list.</p>
      ) : (
        <ul className={s.list}>
          {proposals.map((p) => (
            <li key={p.name}>
              <p>
                <b>{sentence(p.label)}</b> <span className={p.outcome === "refused" ? s.refused : s.status}>{OUTCOME[p.outcome]}</span>
              </p>
              <p className={s.detail}>{detail(p)}</p>
              {p.cites.length > 0 && <p className={s.detail}>Taken from {p.cites.join(", ")} in the machine's notes.</p>}
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}
