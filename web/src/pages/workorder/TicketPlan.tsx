// The plan for a work order drafted from a forecast on a recorded run: the
// server's own ticket, its forecast with how often such ranges have held, the
// sentences with the evidence they rest on, and what a camera saw, unconfirmed.

import { useMemo } from "react";
import { approveTicket, ticketStillUrl } from "../../api/crux";
import type { Ticket } from "../../api/types";
import { hours, num, pct, stamp } from "../../lib/format";
import { plainSentence } from "../../lib/plain";
import { SourceTag } from "../../ui/SourceTag";
import { Field } from "../../ui/Tag";
import { Approval } from "./Approval";
import { ticketLookup } from "./evidence";
import { Cites } from "./EvidenceChip";
import type { HazardOn } from "./hazard";
import { HazardLine } from "./HazardLine";
import { laterOf, patchOrder, recordingSource, writerName } from "./model";
import type { StageProps } from "./types";
import c from "./CasePlan.module.css";
import s from "./stage.module.css";
import t from "./TicketPlan.module.css";

const SAFETY =
  "Crux only recommends. A person approves this work order, and the machine is isolated and locked out under the site's own procedure before anyone works on it.";

const ITEM: Record<string, string> = {
  crack: "Crack",
  leak: "Leak",
  corrosion: "Rust or corrosion",
  belt: "Belt",
  heat: "Heat marks",
  loose: "Loose parts",
  smoke: "Smoke",
};

const STATUS: Record<string, string> = { present: "present", absent: "absent", unsure: "unsure", cannot_see: "can't see" };

export function TicketPlan({
  wo,
  go,
  ticket,
  onTicket,
  hazard,
}: StageProps & { ticket: Ticket; onTicket: (t: Ticket) => void; hazard: HazardOn | null }) {
  const lookup = useMemo(() => ticketLookup(ticket), [ticket]);
  const src = recordingSource(ticket.machine);
  const writer = writerName(ticket.written_by);
  const modelWrote = writer !== ticket.written_by || /gemini|ollama/i.test(ticket.written_by);

  async function approve(name: string) {
    const approved = await approveTicket(ticket.id, name);
    onTicket(approved);
    patchOrder(wo.id, (o) => ({ ...o, approvedBy: name, approvedAt: Date.now(), stage: laterOf(o.stage, "repair") }));
    // Stay on the plan so "Approved by" shows; the person moves on themselves.
    go("plan");
  }

  // The server may already hold an approval this browser didn't record (another tab).
  function next() {
    if (!wo.approvedBy && ticket.status === "approved") {
      patchOrder(wo.id, (o) => ({ ...o, approvedBy: ticket.approved_by, approvedAt: o.approvedAt ?? Date.now(), stage: laterOf(o.stage, "repair") }));
    }
    go("repair");
  }

  const lessons = ticket.evidence.filter((e) => e.kind === "lesson");

  return (
    <div className={s.split}>
      <div className={s.main}>
        {hazard && <HazardLine hazard={hazard} />}
        <Field label="What's wrong" wide>
          <h2 className={c.name}>
            {ticket.part_label} on {ticket.machine_name}
          </h2>
          <p className={s.quiet}>
            At hour {num(ticket.at_h, 1)} of {src.long}. <SourceTag>{src.tag}</SourceTag>
          </p>
        </Field>
        {ticket.fix_within_h && (
          <Field label="Fix within" wide>
            <p className={s.lead}>
              {hours(ticket.fix_within_h[0])} to {hours(ticket.fix_within_h[1])}
              {ticket.likely_h !== null ? `, most likely ${hours(ticket.likely_h)}` : ""}
            </p>
            <p className={s.quiet}>
              A forecast, not a promise. On XJTU-SY bearings, each of 14 held out of training in turn (6 Oct 2026), the truth fell inside ranges like this 42% of the time, against an aim of 80%.
            </p>
          </Field>
        )}
        {ticket.risk_before_stop !== null && ticket.stop_in_h !== null && (
          <Field label="Before the next planned stop" wide>
            <p className={s.sentence}>
              <b>{pct(ticket.risk_before_stop)}</b> chance the part reaches the danger line before the stop in {hours(ticket.stop_in_h)}. A planning aid, not a promise.
            </p>
          </Field>
        )}
        <Field label="The plan" wide>
          {ticket.sentences.map((x) => (
            <p key={x.text} className={s.sentence}>
              {plainSentence(x.text)}
              <Cites ids={x.cites} lookup={lookup} />
            </p>
          ))}
          <p className={s.row}>
            <SourceTag tone={modelWrote ? "model" : "plain"}>{`written by ${modelWrote ? writer : "the template"}`}</SourceTag>
            <span className={s.status}>Each sentence is kept only if the evidence it cites backs it.</span>
          </p>
        </Field>
        {ticket.removed.length > 0 && (
          <Field label={`Removed by the check (${ticket.removed.length})`} wide>
            <ul className={c.removed}>
              {ticket.removed.map((r) => (
                <li key={r.text}>
                  <span className={c.struck}>{r.text}</span>
                  <Cites ids={r.cites} lookup={lookup} />
                  <span className={s.quiet}>The evidence it cites didn't back it.</span>
                </li>
              ))}
            </ul>
          </Field>
        )}
        <CameraLook ticket={ticket} />
        {lessons.length > 0 && (
          <Field label="Lessons from earlier repairs" wide>
            {lessons.map((l) => (
              <p key={l.id} className={s.sentence}>
                {plainSentence(l.statement)}
                <Cites ids={[l.id]} lookup={lookup} />
              </p>
            ))}
          </Field>
        )}
        {ticket.notes.length > 0 && (
          <Field label="About these words" wide>
            {ticket.notes.map((n) => (
              <p key={n} className={s.quiet}>
                {plainSentence(n)}
              </p>
            ))}
          </Field>
        )}
      </div>
      <div className={s.side}>
        <Approval
          approvedBy={wo.approvedBy ?? (ticket.status === "approved" ? ticket.approved_by : undefined)}
          approvedAt={wo.approvedAt}
          onApprove={approve}
          onNext={next}
          nextLabel="Continue"
          safety={ticket.safety || SAFETY}
        />
      </div>
    </div>
  );
}

function CameraLook({ ticket }: { ticket: Ticket }) {
  const cam = ticket.camera;
  if (!cam) {
    return (
      <Field label="Camera look" wide>
        <p className={s.quiet}>No camera covers this machine.</p>
      </Field>
    );
  }
  const boxes = cam.findings.filter((f) => f.box);
  return (
    <Field label="Camera look" wide>
      <div className={t.camera}>
        {ticket.has_still && (
          <figure className={t.still}>
            <img src={ticketStillUrl(ticket.id)} alt={`The latest still from ${cam.camera}`} />
            {boxes.map((f, i) => {
              const [y0, x0, y1, x1] = f.box!;
              return (
                <span
                  key={i}
                  className={t.box}
                  style={{ top: `${y0 / 10}%`, left: `${x0 / 10}%`, height: `${(y1 - y0) / 10}%`, width: `${(x1 - x0) / 10}%` }}
                  title={`${f.what} (unconfirmed)`}
                />
              );
            })}
            <figcaption className={s.quiet}>
              {cam.camera}, {stamp(cam.taken_at)}. {cam.reference ? `Compared with ${cam.reference}.` : "No normal photo to compare with."}
            </figcaption>
          </figure>
        )}
        <div>
          <p className={t.unconfirmed}>Unconfirmed: check before acting.</p>
          <ul className={t.checklist}>
            {cam.checklist.map((f) => (
              <li key={f.item} className={f.status === "present" ? t.present : undefined}>
                <span>{ITEM[f.item] ?? f.item}</span>
                <span className={t.status}>{STATUS[f.status] ?? f.status}</span>
              </li>
            ))}
          </ul>
          <p className={s.quiet}>
            {!cam.inspected_by || /^offline|^none|^nobody/i.test(cam.inspected_by) ? "Nobody has looked at this photo yet." : `Looked at by ${cam.inspected_by}.`}
            {cam.note ? ` ${cam.note}` : ""}
          </p>
          {cam.retake && <p className={s.quiet}>Retake: {cam.retake}</p>}
        </div>
      </div>
    </Field>
  );
}
