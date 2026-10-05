/**
 * Plan the repair: the chance of breaking before the next planned stop, and the
 * repair ticket Crux drafts for a person to approve.
 *
 * Every number comes from the API. The ticket shows each sentence with the
 * evidence it rests on, and lists any sentence the evidence check removed.
 */

import { useEffect, useState } from "react";
import {
  Finding,
  PartReplay,
  Ticket,
  approveTicket,
  draftTicket,
  investigate,
  risk,
  stillUrl,
} from "./api";

function pct(x: number): string {
  return x < 0.01 ? "under 1%" : x > 0.99 ? "over 99%" : `${Math.round(x * 100)}%`;
}

export function TicketPanel({
  machine,
  part,
  now,
  alarmed,
  playing,
}: {
  machine: string;
  part: PartReplay;
  now: number;
  alarmed: boolean;
  playing: boolean;
}) {
  const [stopIn, setStopIn] = useState(24);
  const [odds, setOdds] = useState<number | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState("");
  const [finding, setFinding] = useState<Finding | null>(null);
  const [looking, setLooking] = useState(false);

  // A ticket belongs to one part at one moment; a new part starts clean.
  useEffect(() => {
    setTicket(null);
    setFinding(null);
    setError(null);
  }, [machine, part.part]);

  const look = () => {
    setLooking(true);
    setError(null);
    investigate(machine, part.part, now)
      .then(setFinding)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLooking(false));
  };

  useEffect(() => {
    if (!alarmed || playing) {
      if (!alarmed) setOdds(null);
      return;
    }
    const t = window.setTimeout(() => {
      risk(machine, part.part, now, stopIn)
        .then((r) => setOdds(r.risk))
        .catch(() => setOdds(null));
    }, 250);
    return () => window.clearTimeout(t);
  }, [machine, part.part, now, stopIn, alarmed, playing]);

  const write = () => {
    setBusy(true);
    setError(null);
    draftTicket(machine, part.part, now, stopIn)
      .then(setTicket)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const approve = () => {
    if (!ticket || !who.trim()) return;
    approveTicket(ticket.id, who.trim())
      .then(setTicket)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  if (!alarmed) return null;
  const evidence = new Map(ticket?.evidence.map((e) => [e.id, e]) ?? []);

  return (
    <section className="m-plan">
      <h3>Plan the repair</h3>
      <label className="m-stop">
        Next planned stop in
        <input
          type="number"
          min={0}
          step={1}
          value={stopIn}
          onChange={(e) => setStopIn(Math.max(0, Number(e.target.value)))}
        />
        hours
      </label>
      {odds !== null && (
        <p className="m-odds">
          Chance it reaches the danger line first: <strong>{pct(odds)}</strong>
        </p>
      )}
      <div className="m-actions">
        <button className="m-ticket-btn quiet" onClick={look} disabled={looking}>
          {looking ? "Investigating…" : "Investigate what is wrong"}
        </button>
      </div>
      {finding && (
        <div className={`m-finding${finding.confident ? " sure" : ""}`}>
          <p className="m-finding-head">
            {finding.confident ? "Crux's answer" : "Not settled yet"}:{" "}
            <strong>{finding.leader.label}</strong> ({Math.round(finding.leader.belief * 100)}%
            belief)
          </p>
          <ul className="m-ranked">
            {finding.ranked.map((r) => (
              <li key={r.kind}>
                <span>{r.label}</span>
                <span className="m-bar">
                  <span style={{ width: `${Math.round(r.belief * 100)}%` }} />
                </span>
                <span>{Math.round(r.belief * 100)}%</span>
              </li>
            ))}
          </ul>
          {finding.asked.length > 0 && (
            <p className="m-fine">
              Checks Crux asked for: {finding.asked.join(", ")}. Answered from the recording that
              followed, as a technician's capture would be.
            </p>
          )}
          <p className="m-fine">Reading: {finding.reading}.</p>
        </div>
      )}
      <button className="m-ticket-btn" onClick={write} disabled={busy}>
        {busy ? "Writing…" : ticket ? "Write a new ticket for this moment" : "Draft repair ticket"}
      </button>
      {error && <p className="m-error">{error}</p>}

      {ticket && (
        <article className={`m-ticket${ticket.status === "approved" ? " approved" : ""}`}>
          <header>
            <span className="m-ticket-id">{ticket.id}</span>
            <span className={`m-chip${ticket.status === "approved" ? "" : " draft"}`}>
              {ticket.status === "approved" ? `Approved by ${ticket.approved_by}` : "Draft"}
            </span>
          </header>
          {ticket.hazard && (
            <p className="m-hazard">
              The camera may show a hazard to people: check before anyone goes near.
            </p>
          )}
          <ol className="m-sentences">
            {ticket.sentences.map((s) => (
              <li key={s.text}>
                {s.text}{" "}
                {s.cites.map((c) => (
                  <span key={c} className="m-cite" title={evidence.get(c)?.statement ?? c}>
                    {c}
                  </span>
                ))}
              </li>
            ))}
          </ol>
          {ticket.has_still && (
            <figure className="m-still">
              <img
                src={stillUrl(ticket.id)}
                alt={`Still from ${ticket.camera?.camera ?? "camera"}`}
              />
              <figcaption>
                {ticket.camera?.camera}
                {ticket.camera?.note
                  ? ` · ${ticket.camera.note}`
                  : ` · looked at by ${ticket.camera?.inspected_by}`}
              </figcaption>
            </figure>
          )}
          {ticket.removed.length > 0 && (
            <details className="m-removed">
              <summary>
                {ticket.removed.length} sentence{ticket.removed.length === 1 ? "" : "s"} removed:
                not backed by the evidence
              </summary>
              <ul>
                {ticket.removed.map((s) => (
                  <li key={s.text}>{s.text}</li>
                ))}
              </ul>
            </details>
          )}
          <p className="m-fine">{ticket.safety}</p>
          <p className="m-fine">
            Written by {ticket.written_by}; every sentence checked against the evidence.
            {ticket.notes.length ? ` ${ticket.notes.join(" ")}` : ""}
          </p>
          {ticket.status === "draft" && (
            <div className="m-approve">
              <input
                placeholder="Your name"
                value={who}
                onChange={(e) => setWho(e.target.value)}
                aria-label="Approver's name"
              />
              <button onClick={approve} disabled={!who.trim()}>
                Approve
              </button>
            </div>
          )}
        </article>
      )}
    </section>
  );
}
