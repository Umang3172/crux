// Step three: what Crux found. The tag drops onto its line once, when the
// result lands: the page's one authored moment. It is the physics' reading,
// with the one check that would settle what is left, and a way to keep the scan
// as the machine's normal one.

import type { Scan, ScanAnalysis } from "../../../api/types";
import { rpm } from "../../../lib/format";
import { ButtonLink, Button } from "../../../ui/Button";
import { Field, Fields, Tag } from "../../../ui/Tag";
import { KeepNormal } from "../../scans/KeepNormal";
import { NextCheck } from "../../scans/NextCheck";
import { physicsSentences, upperFirst } from "../../scans/words";
import s from "./Lens.module.css";

export function Result({
  scan,
  analysis,
  onKept,
  onAgain,
}: {
  scan: Scan;
  analysis: ScanAnalysis;
  onKept: (s: Scan) => void;
  onAgain: () => void;
}) {
  const standing = analysis.standing;
  const healthyOnly = standing.length === 1 && standing[0] === "healthy";
  return (
    <>
      <Tag tone={healthyOnly ? "safety" : "caution"} head="Found" drop stamp={scan.normal ? "Normal" : undefined} aria-live="polite">
        <Fields columns={1}>
          <Field label="Shaft speed">
            <span className={s.big}>{rpm(analysis.rpm)}</span>
            <span className={s.hint}>{upperFirst(analysis.speed_note)}.</span>
          </Field>
          <Field label="What the motion says">
            <ul className={s.sentences}>
              {physicsSentences(analysis).map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </Field>
          <Field label="Sound">{upperFirst(analysis.sound_note)}.</Field>
        </Fields>
      </Tag>

      <NextCheck analysis={analysis} />

      <KeepNormal scan={scan} onKept={onKept} />

      <div className={s.stack}>
        <ButtonLink to={`/scans/${scan.id}`} kind="secondary" size="l" className={s.wide}>
          Open the full scan
        </ButtonLink>
        <Button kind="quiet" onClick={onAgain}>
          Scan another
        </Button>
        <p className={s.hint}>Saved on this server and shared by everyone using this demo.</p>
      </div>
    </>
  );
}
