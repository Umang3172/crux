// "Show what really happened": the failure and how the forecast stood against
// it. Everything here is the recording's own answer key, so it appears only
// when the visitor asks.

import { num } from "../../lib/format";
import { Field, Fields, Tag } from "../../ui/Tag";
import { isOverLine, type PartNow } from "./replay";
import { hourFigure, rangeText, sentence } from "./words";

/** Where the truth fell against the forecast in force, in the forecast's own terms. */
function against(focus: PartNow): string {
  const r = focus.range;
  if (!focus.alarmed || !r || r.p10_h === null || r.p90_h === null) return "The alarm had not fired at this moment, so Crux had given no forecast yet.";
  if (isOverLine(r)) return "Crux already said the part was over the danger line.";
  const after = focus.part.end_h - r.at_h;
  const placement = after < r.p10_h ? "sooner than the early end of that range" : after > r.p90_h ? "later than the late end of that range" : "inside that range";
  return `The forecast in force was given at hour ${num(r.at_h, 2)}: ${rangeText(r)} from then. The part failed ${hourFigure(after)} hours after that, ${placement}.`;
}

export function Truth({ focus }: { focus: PartNow }) {
  const p = focus.part;
  return (
    <Tag tone="stock" head="What really happened" aria-live="polite">
      {p.failed ? (
        <Fields columns={2}>
          <Field label="Failed at">Running hour {num(p.end_h, 2)}</Field>
          <Field label="Failure mode">{sentence(p.failure_mode) || "Not recorded"}</Field>
          <Field label="Against the forecast" wide>
            {against(focus)}
          </Field>
        </Fields>
      ) : (
        <Fields columns={1}>
          <Field label="Result" wide>
            {p.label} did not fail during this recording.
          </Field>
        </Fields>
      )}
    </Tag>
  );
}
