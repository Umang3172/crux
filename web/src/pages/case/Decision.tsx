// The measurement the engine asks for: what each suspect predicts it will read,
// how to take it, where the reading landed, and why the engine chose this
// check over the others. Every number is the engine's.

import { useState } from "react";
import { Crosshair, Cpu, Scale, Smartphone, UserRound } from "lucide-react";
import { submitEvidence } from "../../api/crux";
import type { CatalogTest, Considered, RunParams, FaultKind } from "../../api/types";
import type { CaseModel } from "../../lib/casemodel";
import { clock, num, pct, signed } from "../../lib/format";
import { answerWithInstrument, encodeKey } from "../../lib/instrument";
import { check, fault, plainSentence } from "../../lib/plain";
import { isOnList } from "../../lib/scenarios";
import { markAnswered, rememberInvestigation, type CaseEntry } from "../../lib/session";
import { DecisionAxis } from "../../ui/charts";
import { Badge, Button, Callout, Card, type Tone } from "../../ui/kit";
import { QrCode, phoneCheckUrl } from "../../ui/QrCode";

const FATE: Record<Considered["fate"], { label: string; tone: Tone }> = {
  chosen: { label: "chosen", tone: "accent" },
  less_per_minute: { label: "could settle it, slower", tone: "neutral" },
  cannot_settle: { label: "cannot settle it", tone: "neutral" },
  leaders_too_close: { label: "leaders too close", tone: "neutral" },
  already_taken: { label: "already taken", tone: "neutral" },
  no_prediction: { label: "no prediction", tone: "neutral" },
};

const ORDER: Record<string, number> = { chosen: 0, less_per_minute: 1, leaders_too_close: 2, cannot_settle: 3, already_taken: 4, no_prediction: 5 };

export function DecisionCard({ model, entry, catalogue }: { model: CaseModel; entry: CaseEntry; catalogue: CatalogTest[] | null }) {
  const req = model.lastRequest;
  const [busy, setBusy] = useState<"instrument" | "person" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [phone, setPhone] = useState(false);
  if (!req) return null;

  const waiting = model.request !== null;
  const cat = catalogue?.find((t) => t.id === req.test_id);
  const chosen = req.considered.find((c) => c.fate === "chosen");
  const answer = model.checks.filter((c) => c.testId === req.test_id && c.status === "answered").pop();
  const mine = entry.answered[req.test_id];
  const canInstrument = isOnList(entry.params.fault) && !entry.lost;
  const names = check(req.test_id);

  const expected = Object.entries(req.expected_readings)
    .map(([kind, value]) => ({
      kind,
      label: fault(kind).name,
      value,
      tone: req.separates.includes(kind) ? "accent" : "muted",
      faded: !req.separates.includes(kind),
    }))
    .sort((a, b) => Number(a.faded) - Number(b.faded));

  async function takeWithInstrument() {
    setBusy("instrument");
    setError(null);
    try {
      const r = await answerWithInstrument(entry.id, entry.params as RunParams & { fault: FaultKind });
      rememberInvestigation(r.inv);
      if (!r.already && r.value !== undefined) markAnswered(entry.id, req!.test_id, "virtual instrument", "here", r.value);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function sendTyped() {
    const value = Number(typed);
    if (typed.trim() === "" || Number.isNaN(value)) return setError("Type the reading as a number.");
    setBusy("person");
    setError(null);
    try {
      const inv = await submitEvidence(entry.id, req!.test_id, value, "technician");
      rememberInvestigation(inv);
      markAnswered(entry.id, req!.test_id, "person", "here", value);
      setTyped("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      tone={waiting ? "accent" : undefined}
      title={waiting ? "Crux is asking for one measurement" : "The measurement that was asked for"}
      icon={<Crosshair size={15} />}
      actions={<Badge tone="accent">chosen by the engine: most information per minute</Badge>}
    >
      <div className="row row-wrap between">
        <div>
          <h3 style={{ fontSize: "var(--fs-16)" }}>{names.name}</h3>
          <div className="small muted">
            {cat?.name ?? chosen?.name} · at {names.where}
          </div>
        </div>
        <div className="decision-facts" style={{ margin: 0 }}>
          <Badge>{cat?.effort_min ?? chosen?.minutes} min</Badge>
          <Badge>{(cat?.downtime ?? chosen?.downtime) === "none" ? "machine keeps running" : (cat?.downtime ?? chosen?.downtime)}</Badge>
          {chosen?.apart_sigma != null && <Badge title="How far apart the leaders' predictions sit, in units of this measurement's spread">leaders {num(chosen.apart_sigma, 1)}σ apart</Badge>}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <DecisionAxis expected={expected} sigma={req.sigma} reading={answer?.reading ?? null} readingLabel="came back" />
      </div>
      <p className="small dim" style={{ marginTop: 4 }}>
        Each bar is what that suspect predicts this measurement reads, give or take the measurement's own spread (σ = {num(req.sigma, 2)}). Predictions come from simulating each suspect, not from a table.
      </p>

      {answer && (
        <div style={{ marginTop: 14 }}>
          <Callout tone="ok">
            The reading came back at <b className="num">{signed(answer.reading ?? 0, 2)}</b>
            {mine ? (
              <>
                , taken by {mine.by === "virtual instrument" ? "the pump model's own instrument" : "a person"} {mine.from === "phone" ? "on a phone" : "here"} at {clock(mine.at)}.
              </>
            ) : (
              "."
            )}{" "}
            {mine?.by === "virtual instrument" && "The pump model answers from the fault it was given, so this stands in for a technician's reading."}
          </Callout>
        </div>
      )}

      {waiting && (
        <div className="answer-box">
          <div className="col gap-3">
            <div>
              <div className="eyebrow">How to take it</div>
              <ol className="steps" style={{ marginTop: 8 }}>
                {(cat?.procedure ?? []).map((p) => (
                  <li key={p}>
                    <span>{p}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="row row-wrap">
              <Button variant="primary" icon={<Cpu size={14} />} busy={busy === "instrument"} disabled={!canInstrument || busy !== null} onClick={takeWithInstrument}>
                Take it with the pump model's instrument
              </Button>
              <Button icon={<Smartphone size={14} />} onClick={() => setPhone((p) => !p)} disabled={!canInstrument}>
                Send to a phone
              </Button>
            </div>
            <div className="row row-wrap">
              <input className="input num" style={{ width: 150 }} inputMode="decimal" placeholder="or type a reading" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="A reading typed by a person" />
              <Button icon={<UserRound size={14} />} busy={busy === "person"} disabled={busy !== null || entry.lost} onClick={sendTyped}>
                Hand it in as a person
              </Button>
            </div>
            <span className="small dim">The pump is a physics model. Its instrument takes a new simulated capture of the same pump in the same state; it knows the fault it was given, and says so.</span>
            {error && <Callout tone="danger">{error}</Callout>}
          </div>
          {phone && canInstrument && (
            <div className="col" style={{ alignItems: "center" }}>
              <div className="qr">
                <QrCode value={phoneCheckUrl(entry.id, encodeKey(entry.params as RunParams & { fault: FaultKind }))} size={148} label="Open this measurement on a phone" />
              </div>
              <span className="small dim" style={{ maxWidth: 170, textAlign: "center" }}>
                Scan to take the reading on a phone. This page updates when it lands.
              </span>
            </div>
          )}
        </div>
      )}

      <Menu considered={req.considered} />
    </Card>
  );
}

/** Every check the engine weighed, and why each was or was not offered. */
export function Menu({ considered }: { considered: Considered[] }) {
  if (considered.length === 0) return null;
  const rows = [...considered].sort((a, b) => (ORDER[a.fate] ?? 9) - (ORDER[b.fate] ?? 9));
  return (
    <div style={{ marginTop: 20 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <Scale size={14} className="dim" aria-hidden />
        <h3>Why this check and not the others</h3>
      </div>
      <div className="table-wrap" style={{ margin: "0 calc(-1 * var(--s-4)) calc(-1 * var(--s-4))" }}>
        <table className="table compact">
          <thead>
            <tr>
              <th style={{ paddingLeft: 16 }}>Check</th>
              <th className="t-num">Minutes</th>
              <th className="t-num" data-tip="How much the answer is expected to tell, in nats">
                Information
              </th>
              <th className="t-num">Per minute</th>
              <th className="t-num" data-tip="The chance its answer brings one suspect to the bar">
                Settles it
              </th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.test_id} className={c.fate === "chosen" ? "on" : undefined}>
                <td style={{ paddingLeft: 16 }}>
                  <div className="strong">{check(c.test_id).name}</div>
                  <div className="small dim">{plainSentence(c.why)}</div>
                </td>
                <td className="t-num">{c.minutes}</td>
                <td className="t-num">{c.gain === null ? "–" : num(c.gain, 3)}</td>
                <td className="t-num">{c.gain_per_minute === null ? "–" : num(c.gain_per_minute, 3)}</td>
                <td className="t-num">{c.settle_chance === null ? "–" : pct(c.settle_chance)}</td>
                <td>
                  <Badge tone={FATE[c.fate].tone}>{FATE[c.fate].label}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
