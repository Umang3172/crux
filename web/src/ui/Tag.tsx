// The tag hung on the machine: the one place the visual world speaks. Its
// head colour is its class (blue: measure this; yellow: needs attention or
// under test; green: normal or verified; red: hazard), its fields are ruled,
// and a ruled-out or answered tag is punched rather than removed.

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useReducedMotion } from "../lib/hooks";
import s from "./Tag.module.css";

export type TagTone = "measure" | "caution" | "safety" | "danger" | "stock" | "void" | "written";

export function Tag({
  tone,
  head,
  children,
  hole = true,
  line = false,
  drop = false,
  stamp,
  size = "full",
  className,
  as: As = "section",
  ...aria
}: {
  tone: TagTone;
  head: ReactNode;
  children?: ReactNode;
  /** The punched hole the string goes through. */
  hole?: boolean;
  /** A string rising from the hole, for a tag hung from a point above it. */
  line?: boolean;
  /** Fall onto the line when it appears: the one authored moment. */
  drop?: boolean;
  /** A stamp across the tag: "Answered", "Void", "Verified". */
  stamp?: string;
  size?: "full" | "rack";
  className?: string;
  as?: "section" | "div" | "li" | "article";
  "aria-label"?: string;
  "aria-live"?: "polite" | "off";
}) {
  const reduce = useReducedMotion();
  const body = (
    <As className={[s.tag, s[tone], s[size], className].filter(Boolean).join(" ")} {...aria}>
      {line && <span className={s.line} aria-hidden="true" />}
      <header className={s.head}>
        {hole && <span className={s.hole} aria-hidden="true" />}
        <span className={s.headText}>{head}</span>
      </header>
      {children !== undefined && <div className={s.body}>{children}</div>}
      {stamp && (
        <span className={s.stamp} aria-label={stamp}>
          {stamp}
        </span>
      )}
    </As>
  );
  if (!drop || reduce) return body;
  return (
    <motion.div
      initial={{ y: -28, opacity: 0, rotate: -1.5 }}
      animate={{ y: 0, opacity: 1, rotate: 0 }}
      // One fall and a long, even settle: no bounce, so it reads as a tag finding its string.
      transition={{ duration: 0.48, ease: [0.16, 1, 0.3, 1] }}
      style={{ transformOrigin: "50% 0%" }}
    >
      {body}
    </motion.div>
  );
}

/** A ruled field on a tag: a small capital label over its value. */
export function Field({
  label,
  children,
  wide = false,
  className,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    <div className={[s.field, wide ? s.wide : "", className].filter(Boolean).join(" ")}>
      <span className={s.label}>{label}</span>
      <div className={s.value}>{children}</div>
    </div>
  );
}

/** Fields laid out on the tag's ruled module. */
export function Fields({ children, columns = 2 }: { children: ReactNode; columns?: 1 | 2 | 3 }) {
  return (
    <div className={s.fields} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {children}
    </div>
  );
}
