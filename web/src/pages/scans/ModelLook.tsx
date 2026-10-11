// What the camera look saw. Every word here is a model's, so the block carries
// the model's name and every finding is marked unconfirmed. When no model is on
// it says so and draws nothing: the physics still runs on the motion.

import type { Finding, Scan } from "../../api/types";
import { SourceTag } from "../../ui/SourceTag";
import { lookedBy, lookOf, STATUS_WORD } from "./words";
import s from "./ModelLook.module.css";

export function ModelLook({ scan }: { scan: Scan }) {
  const look = lookOf(scan);
  const by = lookedBy(look.inspected_by);
  const identityBy = lookedBy(scan.identity.by);
  const findings = look.findings ?? [];
  const checklist = look.checklist ?? [];

  if (!by && !identityBy) {
    return (
      <div className={s.block}>
        <p>
          <SourceTag tone="model">No model looked</SourceTag>
        </p>
        <p className={s.lead}>Nobody has looked at this clip yet; nothing is drawn on it, and the physics still runs.</p>
        {look.retake && <p className={s.quiet}>The photo check also turned the still back: {look.retake}.</p>}
      </div>
    );
  }

  return (
    <div className={s.block}>
      <p className={s.voice}>
        <SourceTag tone="model">{`Read by ${by ?? identityBy}`}</SourceTag>
        <span>Unconfirmed: check before acting.</span>
      </p>

      {identityBy && (
        <dl className={s.identity}>
          <div>
            <dt>Looks like</dt>
            <dd>{scan.identity.machine_type || "The model did not name it."}</dd>
          </div>
          {scan.identity.nameplate_text && (
            <div>
              <dt>Nameplate, as the model read it</dt>
              <dd className={s.plate}>{scan.identity.nameplate_text}</dd>
              <dd className={s.quiet}>Shown, never used as a number: a person types the speed.</dd>
            </div>
          )}
          {scan.identity.box_label && (
            <div>
              <dt>Boxed</dt>
              <dd>{scan.identity.box_label}</dd>
            </div>
          )}
        </dl>
      )}
      {scan.identity.note && <p className={s.quiet}>{scan.identity.note}</p>}

      {by ? (
        <>
          <h3 className={s.sub}>Visible trouble</h3>
          {findings.length === 0 ? (
            <p>The model found nothing that held up on a second look.</p>
          ) : (
            <ul className={s.findings}>
              {findings.map((f, i) => (
                <FindingRow key={`${f.item}-${i}`} f={f} />
              ))}
            </ul>
          )}
          {(look.dropped ?? 0) > 0 && (
            <p className={s.quiet}>A first look reported {look.dropped} more that a second look could not confirm, so they were dropped.</p>
          )}
          {look.retake && <p className={s.quiet}>The still was turned back: {look.retake}.</p>}
          {look.note && <p className={s.quiet}>{look.note}</p>}
          {checklist.length > 0 && (
            <details className={s.details}>
              <summary>Everything the model was asked ({checklist.length} items)</summary>
              <ul className={s.checklist}>
                {checklist.map((c, i) => (
                  <li key={`${c.item}-${i}`}>
                    <span className={s.item}>{c.what}</span>
                    <span className={s.status}>{STATUS_WORD[c.status] ?? c.status}</span>
                    {c.evidence && <span className={s.evidence}>{c.evidence}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        look.retake && <p className={s.quiet}>The photo check turned the still back, so no trouble was looked for: {look.retake}.</p>
      )}
    </div>
  );
}

function FindingRow({ f }: { f: Finding }) {
  const against =
    f.new_since_reference === "yes"
      ? "New since the normal photo."
      : f.new_since_reference === "no"
        ? "Also in the normal photo."
        : "No normal photo to compare with.";
  return (
    <li className={s.finding}>
      <p className={s.what}>{f.what}</p>
      {f.where && <p>{f.where}</p>}
      {f.evidence && f.evidence !== f.where && <p className={s.quiet}>{f.evidence}</p>}
      <p className={s.quiet}>
        {f.severity !== "none" && `Graded ${f.severity} by the model. `}
        {against}
      </p>
      {f.hazard && <p className={s.hazard}>The model marked this a possible hazard.</p>}
      <p>
        <SourceTag tone="model">Unconfirmed: check before acting</SourceTag>
      </p>
    </li>
  );
}
