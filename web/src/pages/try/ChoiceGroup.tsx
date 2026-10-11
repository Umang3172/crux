// A radio group drawn as large tiles. Each choice is a native radio, so the
// arrow keys, focus and screen readers work without any of it being rebuilt;
// the dot is a punched hole, empty until chosen. A group can hold several
// blocks of tiles under small captions and still be one radio group.

import type { CSSProperties } from "react";
import { SourceTag } from "../../ui/SourceTag";
import s from "./ChoiceGroup.module.css";

type Value = string | number | boolean;

export type Option<T extends Value> = {
  value: T;
  label: string;
  hint?: string;
  /** A small label naming who or what does it, e.g. the AI's name. */
  tag?: string;
  disabled?: boolean;
};

export type Group<T extends Value> = { caption?: string; columns: number; options: Option<T>[] };

export function ChoiceGroup<T extends Value>({
  name,
  labelledBy,
  value,
  onChange,
  groups,
}: {
  name: string;
  /** The id of the heading that names this group. */
  labelledBy: string;
  value: T;
  onChange: (value: T) => void;
  groups: Group<T>[];
}) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className={s.group}>
      {groups.map((g, i) => (
        <div key={i} className={s.block}>
          {g.caption && <p className={s.caption}>{g.caption}</p>}
          <div className={s.grid} style={{ "--cols": g.columns } as CSSProperties}>
            {g.options.map((o) => (
              <label key={String(o.value)} className={s.option}>
                <input
                  type="radio"
                  className="visually-hidden"
                  name={name}
                  value={String(o.value)}
                  checked={o.value === value}
                  disabled={o.disabled}
                  onChange={() => onChange(o.value)}
                />
                <span className={s.dot} aria-hidden="true" />
                <span className={s.text}>
                  <span className={s.name}>{o.label}</span>
                  {o.hint && <span className={s.hint}>{o.hint}</span>}
                  {o.tag && (
                    <span className={s.tag}>
                      <SourceTag tone="model">{o.tag}</SourceTag>
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
