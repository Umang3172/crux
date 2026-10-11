// The lessons this site holds, for rolling bearings, searchable by words. A
// lesson is knowledge for a technician to read; it never moves a belief.

import { useEffect, useId, useState } from "react";
import { lessons } from "../../api/crux";
import { useAsync } from "../../lib/hooks";
import { Button } from "../../ui/Button";
import { Empty, ErrorState } from "../../ui/States";
import { LessonTag } from "./LessonTag";
import s from "./Lessons.module.css";

const PAGE = 10;

export function Lessons({ held }: { held: number }) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [k, setK] = useState(PAGE);

  // Wait for a pause in typing before asking the server again.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(typed.trim());
      setK(PAGE);
    }, 300);
    return () => window.clearTimeout(t);
  }, [typed]);

  // `held` changes when an update or an alert adds lessons, so the list is read again.
  const found = useAsync(() => lessons("rolling bearing", q, k), [q, k, held]);
  const items = found.data ?? [];
  // With no words typed the server returns the newest last; a person wants the newest first.
  const shown = q ? items : [...items].reverse();

  return (
    <div className={s.wrap}>
      <div className={s.search}>
        <label htmlFor={id} className={s.label}>
          Search the lessons
        </label>
        <input
          id={id}
          type="search"
          className={s.input}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Words from a situation, e.g. cage or restart"
          autoComplete="off"
        />
      </div>

      {found.error && !found.data ? (
        <ErrorState error={found.error} onRetry={found.reload} title="The lessons could not be read" />
      ) : shown.length === 0 && !found.loading ? (
        q ? (
          <Empty title="No lesson matches those words">Lessons are matched by the words they share with what you typed. Try fewer or different words.</Empty>
        ) : (
          <Empty title="No lessons yet">
            Lessons appear when a technician closes a repair with what they found, or when an alert from another site is applied.
          </Empty>
        )
      ) : (
        <ul className={s.grid} aria-busy={found.loading || undefined}>
          {shown.map((l) => (
            <LessonTag key={l.id} lesson={l} />
          ))}
        </ul>
      )}

      {items.length >= k && (
        <div>
          <Button kind="secondary" onClick={() => setK((n) => n + PAGE)} disabled={found.loading}>
            Show more lessons
          </Button>
        </div>
      )}
    </div>
  );
}
