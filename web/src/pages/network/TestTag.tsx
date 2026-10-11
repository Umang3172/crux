// This site's own test of a staged update: the update's time-left model against
// the one in use, on failures this site recorded that the update was never
// trained on. The head carries the verdict as its class, the way a tag does:
// yellow while under test, then green, grey punched, or yellow again when
// there was nothing to test on and a person must decide.

import { Field, Fields, Tag, type TagTone } from "../../ui/Tag";
import { SourceTag } from "../../ui/SourceTag";
import { TestTable } from "./TestTable";
import { STEP } from "./useArrival";
import { plural, verdictOf, VERDICT_WORD, type Staged, type Verdict } from "./words";
import s from "./Tags.module.css";

const TONE: Record<Verdict, TagTone> = { passed: "safety", failed: "void", untested: "caution", lessons: "stock" };

export function TestTag({ staged, step }: { staged: Staged | null; step: number }) {
  if (!staged) {
    return (
      <Tag tone="stock" head="Test" as="div">
        <Fields columns={1}>
          <Field label="Nothing to test">
            An update staged here is tested on this site's own past failures before anyone can install it.
          </Field>
        </Fields>
      </Tag>
    );
  }

  const report = staged.report;
  const verdict = verdictOf(report);
  const decided = step >= STEP.verdict;
  const head = decided ? VERDICT_WORD[verdict] : "Test";
  const tone: TagTone = decided ? TONE[verdict] : "caution";
  const runs = report.runs ?? 0;
  const both = report.current && report.candidate ? { ...report, current: report.current, candidate: report.candidate } : null;

  return (
    <Tag tone={tone} head={head} as="div">
      {/* Said once, when the verdict shows; the figures counting up are not read out. */}
      <p className="visually-hidden" role="status">
        {decided ? `Version ${staged.version}: ${VERDICT_WORD[verdict]}. ${report.reason}.` : ""}
      </p>
      <Fields columns={1}>
        <Field label="Update">
          <span className={s.big}>Version {staged.version}</span>
        </Field>
        {both ? (
          <>
            <Field label="Tested on">
              <span>
                {plural(runs, "failure")} recorded at this site, none of them in the update's training.
              </span>
              <SourceTag>recorded failures</SourceTag>
            </Field>
            <Field label="Result">
              <TestTable report={both} step={step} />
            </Field>
          </>
        ) : null}
        <Field label="The test says">
          {/* The engine's own sentence, and what follows from it when there was no model to test. */}
          <span className={s.quote}>{report.reason}</span>
          {verdict === "lessons" && <span className={s.quiet}>Nothing in this update changes how time left is worked out.</span>}
          {verdict === "untested" && <span className={s.quiet}>A person decides without a test.</span>}
          {verdict === "failed" && <span className={s.quiet}>The server refuses to install it.</span>}
        </Field>
      </Fields>
    </Tag>
  );
}
