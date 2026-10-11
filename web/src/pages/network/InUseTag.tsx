// What this site runs now: its name, the time-left model in use, the update
// installed (none means the model it started with), and the lessons it holds.

import type { FleetStatus } from "../../api/types";
import { Field, Fields, Tag } from "../../ui/Tag";
import { modelLabel, plural } from "./words";
import s from "./Tags.module.css";

export function InUseTag({ status }: { status: FleetStatus }) {
  const model = modelLabel(status.model);
  const installed = status.active !== null;
  return (
    <Tag tone={installed ? "safety" : "stock"} head="In use" as="div">
      <Fields columns={1}>
        <Field label="This site">
          <span className={s.big}>{status.site}</span>
        </Field>
        <Field label="Time-left model">
          <span className={s.name}>{model.name}</span>
          {model.what && <span className={s.quiet}>{model.what}</span>}
        </Field>
        <Field label="Update installed">
          {installed ? `Version ${status.active}` : "None: the model this site started with"}
        </Field>
        <Field label="Lessons held">
          {plural(status.lessons, "lesson")}
        </Field>
      </Fields>
    </Tag>
  );
}
