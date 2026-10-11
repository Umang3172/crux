// The one measurement that would settle what the scan leaves open, hung as a
// blue tag like every check Crux asks for. The steps and the minutes are the
// catalogue's; nothing here is typed.

import type { ScanAnalysis } from "../../api/types";
import { minutes } from "../../lib/format";
import { useCatalogue } from "../../lib/hooks";
import { Field, Fields, Tag } from "../../ui/Tag";
import s from "./NextCheck.module.css";

export function NextCheck({ analysis }: { analysis: ScanAnalysis }) {
  const next = analysis.next_check;
  const catalogue = useCatalogue();
  if (!next) return null;
  const test = catalogue.data?.find((t) => t.id === next.id);
  return (
    <Tag tone="measure" head="Measure" aria-label="The check that would settle what is left">
      <Fields columns={2}>
        <Field label="Check" wide>
          <span className={s.name}>{next.name}</span>
        </Field>
        {test && (
          <>
            <Field label="Time">
              <span className={s.figure}>{minutes(test.effort_min)}</span>
            </Field>
            <Field label="Machine">{test.downtime === "none" ? "Keeps running" : "Needs a brief stop"}</Field>
          </>
        )}
        <Field label="Steps" wide>
          <ol className={s.steps}>
            {next.procedure.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Field>
      </Fields>
    </Tag>
  );
}
