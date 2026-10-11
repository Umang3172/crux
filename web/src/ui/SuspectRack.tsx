// Every suspect as a tag on one rack. Tags keep their place as beliefs move,
// so the eye follows a suspect rather than a row. A ruled-out tag is punched
// VOID and stays on the rack: it can come back if a reading favours it.

import { LayoutGroup, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { pct } from "../lib/format";
import { useReducedMotion } from "../lib/hooks";
import { fault } from "../lib/plain";
import { CountUp } from "./CountUp";
import { Tag, type TagTone } from "./Tag";
import s from "./SuspectRack.module.css";

export type RackSuspect = {
  kind: string;
  label?: string;
  belief: number | null;
  ruledOut: boolean;
  origin?: "catalogue" | "written";
  /** Refused before testing: the reason shows on the tag. */
  refused?: string;
  /** A line under the name, e.g. the document a suspect came from. */
  note?: string;
};

/** Kinds that have just been ruled out, so their tags can take the punch once. */
function usePunched(suspects: RackSuspect[]): Set<string> {
  const before = useRef<Map<string, boolean>>(new Map());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    const now = new Set<string>();
    for (const x of suspects) {
      const out = x.ruledOut || !!x.refused;
      if (out && before.current.get(x.kind) === false) now.add(x.kind);
      before.current.set(x.kind, out);
    }
    if (now.size) {
      setFresh(now);
      const t = window.setTimeout(() => setFresh(new Set()), 700);
      return () => window.clearTimeout(t);
    }
  }, [suspects]);
  return fresh;
}

export function SuspectRack({
  suspects,
  order,
  leaders = [],
  verdict,
  caption,
}: {
  suspects: RackSuspect[];
  /** Kinds in the order the tags hang; new kinds join at the end. */
  order?: string[];
  /** The two suspects Crux can't tell apart, drawn larger. */
  leaders?: string[];
  /** The cause the engine named; its tag takes the verdict's class. */
  verdict?: string | null;
  caption?: string;
}) {
  const reduce = useReducedMotion();
  const sorted = sortBy(suspects, order);
  const punched = usePunched(suspects);
  return (
    <figure className={s.rack} aria-label={caption ?? "Suspects and how likely each is"}>
      <div className={s.rail} aria-hidden="true" />
      <LayoutGroup>
        <ul className={s.tags}>
          {sorted.map((x) => {
            const tone = toneOf(x, verdict);
            const lead = leaders.includes(x.kind);
            const f = fault(x.kind);
            return (
              <motion.li
                key={x.kind}
                layout={!reduce}
                transition={{ type: "spring", stiffness: 380, damping: 34 }}
                className={[s.slot, lead ? s.lead : "", tone === "void" ? s.voided : "", punched.has(x.kind) && !reduce ? s.punch : ""].join(" ")}
              >
                <span className={s.hook} aria-hidden="true" />
                <Tag tone={tone} head={headOf(x, tone, verdict)} size="rack" as="div" stamp={x.refused ? "Refused" : undefined}>
                  <span className={s.pct}>
                    {x.belief === null ? "–" : <CountUp value={x.belief} format={pct} />}
                  </span>
                  <span className={s.name}>{x.label && x.origin === "written" ? sentenceCase(x.label) : f.name}</span>
                  {x.origin === "written" && <span className={s.sub}>Written by the AI, tested by the physics</span>}
                  {x.refused && <span className={s.sub}>{x.refused}</span>}
                  {x.note && <span className={s.sub}>{x.note}</span>}
                </Tag>
              </motion.li>
            );
          })}
        </ul>
      </LayoutGroup>
      {caption && <figcaption className={s.caption}>{caption}</figcaption>}
    </figure>
  );
}

function toneOf(x: RackSuspect, verdict?: string | null): TagTone {
  if (x.refused || x.ruledOut) return "void";
  if (verdict && x.kind === verdict) return verdict === "healthy" ? "safety" : "caution";
  if (verdict) return "stock";
  if (x.kind === "healthy") return "safety";
  if (x.origin === "written") return "written";
  return "caution";
}

function headOf(x: RackSuspect, tone: TagTone, verdict?: string | null): string {
  if (tone === "void") return x.refused ? "Refused" : "Void";
  if (verdict && x.kind === verdict) return "Named";
  return x.kind === "healthy" ? "Normal" : "Suspect";
}

function sortBy(xs: RackSuspect[], order?: string[]): RackSuspect[] {
  if (!order) return [...xs].sort((a, b) => (b.belief ?? 0) - (a.belief ?? 0));
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i === -1 ? order.length : i;
  };
  return [...xs].sort((a, b) => rank(a.kind) - rank(b.kind));
}

const sentenceCase = (t: string) => t.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
