// A lesson is a small tag: green when it records what worked, yellow when it
// records a pitfall. It says when it applies, what to do, what to avoid, where
// it came from, and who confirmed it (or that nobody did).

import type { Lesson } from "../../api/types";
import { stamp } from "../../lib/format";
import { Tag } from "../../ui/Tag";
import s from "./LessonTag.module.css";

export function LessonTag({ lesson }: { lesson: Lesson }) {
  const worked = lesson.outcome === "success";
  return (
    <Tag tone={worked ? "safety" : "caution"} head={worked ? "Worked" : "Pitfall"} size="rack" as="li">
      <h3 className={s.title}>{lesson.title}</h3>
      <dl className={s.rows}>
        <div>
          <dt>When</dt>
          <dd>{lesson.when}</dd>
        </div>
        <div>
          <dt>Do</dt>
          <dd>{lesson.do}</dd>
        </div>
        {lesson.avoid && (
          <div>
            <dt>Avoid</dt>
            <dd>{lesson.avoid}</dd>
          </div>
        )}
      </dl>
      <dl className={s.foot}>
        <div>
          <dt>Source</dt>
          <dd>{lesson.source}</dd>
        </div>
        <div>
          <dt>Confirmed by</dt>
          <dd>{lesson.confirmed_by || "no one yet"}</dd>
        </div>
        <div>
          <dt>Written</dt>
          <dd>{stamp(lesson.created)}</dd>
        </div>
      </dl>
    </Tag>
  );
}
