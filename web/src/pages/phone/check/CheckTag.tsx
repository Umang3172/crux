// The check Crux asked for, as the blue MEASURE tag. When a reading lands the
// tag is punched ANSWERED: the stamp goes on the head band and the tag presses
// down a hair, once. That is the page's one authored moment, and only a
// reading triggers it.

import { motion } from "motion/react";
import type { CatalogTest } from "../../../api/types";
import { minutes } from "../../../lib/format";
import { useReducedMotion } from "../../../lib/hooks";
import { check } from "../../../lib/plain";
import { Icon } from "../../../ui/Icon";
import { Field, Fields, Tag } from "../../../ui/Tag";
import { readingText } from "./caseLine";
import s from "./CheckTag.module.css";

/** `value` is null when another screen took the reading. */
export type Answered = { value: number | null };

export function CheckTag({ test, answered }: { test: CatalogTest; answered?: Answered }) {
  const reduce = useReducedMotion();
  const c = check(test.id);
  const keepsRunning = test.downtime === "none";

  const pumpField = (
    <Field label="Pump">
      <span className={s.run}>
        <Icon name={keepsRunning ? "running" : "stop"} size={20} />
        {keepsRunning ? "Keeps running" : "Needs a brief stop"}
      </span>
    </Field>
  );

  return (
    <motion.div
      initial={false}
      animate={answered && !reduce ? { y: [0, 3, 0] } : { y: 0 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
    >
      <Tag tone="measure" head="Measure" stamp={answered ? "Answered" : undefined} aria-label="The check Crux asked for">
        <Fields columns={2}>
          <Field label="Check" wide>
            <span className={s.name}>{c.name}</span>
            <span className={s.where}>at {c.where}</span>
          </Field>
          {answered && (
            <Field label="Reading" wide>
              {answered.value === null ? (
                <span className={s.elsewhere}>Taken on another screen</span>
              ) : (
                <>
                  <span className={s.reading}>{readingText(test.id, answered.value)}</span>
                  <span className={s.source}>
                    From the pump model's virtual instrument, which answers from the fault it was given.
                  </span>
                </>
              )}
            </Field>
          )}
          <Field label="Time">
            <span className={s.minutes}>{minutes(test.effort_min)}</span>
          </Field>
          {pumpField}
        </Fields>
      </Tag>
    </motion.div>
  );
}
