// The measurement the engine asks for: what each suspect predicts it will read,
// where the reading landed, and why the engine chose it over the others.
// Every number is the engine's.

import { useState } from "react";
import { Link } from "react-router";
import { Cpu, Crosshair, Keyboard, Scale, ScanLine, Smartphone } from "lucide-react";
import { answerWithScan, scans as fetchScans, submitEvidence } from "../../api/crux";
import type { CatalogTest, Considered, FaultKind, RunParams, TestRequest } from "../../api/types";
import type { CaseModel } from "../../lib/casemodel";
import { clock, num, pct, stamp } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { answerWithInstrument, encodeKey } from "../../lib/instrument";
import { check, fault, plainSentence } from "../../lib/plain";
import { machineOfCase } from "../../lib/plant";
import { isOnList } from "../../lib/scenarios";
import { markAnswered, rememberInvestigation, type CaseEntry } from "../../lib/session";
import { DecisionAxis } from "../../ui/charts";
import { Badge, Button, Callout, Card, Details, Hint, cx, type Tone } from "../../ui/kit";
import { QrCode, phoneCheckUrl } from "../../ui/QrCode";

/**
 * The checks a phone scan can stand in for, and which of its sensors does it
 * (the server's lens/answer.py decides; this only words the offer).
 */
const PHONE_SENSOR: Partial<Record<string, string>> = {
  envelope: "sound",
  vib_10s: "motion",
  half_order: "motion",
};

/** Where to record a scan for this case: the phone-scan page, told the machine and the case. */
export const scanForCase = (machineName: string, caseId: string) => `/lens?machine=${encodeURIComponent(machineName)}&case=${encodeURIComponent(caseId)}`;

const FATE: Record<Considered["fate"], { label: string; tone: Tone }> = {
  chosen: { label: "chosen", tone: "accent" },
  less_per_minute: { label: "slower", tone: "neutral" },
  cannot_settle: { label: "cannot settle", tone: "neutral" },
  leaders_too_close: { label: "too close", tone: "neutral" },
  already_taken: { label: "taken", tone: "neutral" },
  no_prediction: { label: "no prediction", tone: "neutral" },
};

const ORDER: Record<string, number> = { chosen: 0, less_per_minute: 1, leaders_too_close: 2, cannot_settle: 3, already_taken: 4, no_prediction: 5 };

/** Take the reading the engine asked for: with the model's own instrument, on a phone, or typed in by a technician. */
export function TakeReading({ entry, req, className }: { entry: CaseEntry; req: TestRequest; className?: string }) {
  const [busy, setBusy] = useState<"instrument" | "person" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState<"phone" | "type" | "scan" | null>(null);
  const canInstrument = isOnList(entry.params.fault) && !entry.lost;
  const key = canInstrument ? encodeKey(entry.params as RunParams & { fault: FaultKind }) : null;
  const sensor = PHONE_SENSOR[req.test_id];

  async function instrument() {
    setBusy("instrument");
    setError(null);
    try {
      const r = await answerWithInstrument(entry.id, entry.params as RunParams & { fault: FaultKind });
      rememberInvestigation(r.inv);
      if (!r.already && r.value !== undefined) markAnswered(entry.id, req.test_id, "virtual instrument", "here", r.value);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function hand() {
    const value = Number(typed);
    if (typed.trim() === "" || Number.isNaN(value)) return setError("Type the reading as a number.");
    setBusy("person");
    setError(null);
    try {
      const inv = await submitEvidence(entry.id, req.test_id, value, "technician");
      rememberInvestigation(inv);
      markAnswered(entry.id, req.test_id, "person", "here", value);
      setTyped("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={cx("take", className)}>
      <div className="take-actions">
        <Button variant="primary" icon={<Cpu size={14} />} busy={busy === "instrument"} disabled={!canInstrument || busy !== null} onClick={instrument}>
          Take the reading
        </Button>
        <Button icon={<Smartphone size={14} />} aria-expanded={open === "phone"} disabled={!canInstrument} onClick={() => setOpen((o) => (o === "phone" ? null : "phone"))}>
          Send to phone
        </Button>
        <Button icon={<Keyboard size={14} />} aria-expanded={open === "type"} disabled={!!entry.lost || busy !== null} onClick={() => setOpen((o) => (o === "type" ? null : "type"))}>
          Type a reading
        </Button>
        <span data-tip={sensor ? undefined : "A phone cannot measure this check"}>
          <Button icon={<ScanLine size={14} />} aria-expanded={open === "scan"} disabled={!sensor || !!entry.lost || busy !== null} onClick={() => setOpen((o) => (o === "scan" ? null : "scan"))}>
            Use a phone scan
          </Button>
        </span>
      </div>
      {canInstrument && (
        <p className="take-note">
          <Badge tone="sim" plain>
            simulated
          </Badge>
          The model's instrument answers from the fault it was given.
        </p>
      )}
      {open === "type" && (
        <form
          className="take-panel take-type"
          onSubmit={(e) => {
            e.preventDefault();
            void hand();
          }}
        >
          <input className="input num" inputMode="decimal" placeholder="Reading" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="The reading, typed by a technician" autoFocus />
          <Button type="submit" busy={busy === "person"} disabled={busy !== null || !typed.trim()}>
            Hand it in
          </Button>
        </form>
      )}
      {open === "phone" && key && (
        <div className="take-panel take-phone">
          <div className="qr">
            <QrCode value={phoneCheckUrl(entry.id, key, entry.machine ?? "p2")} size={128} label="Open this measurement on a phone" />
          </div>
          <span>Scan with a phone. This page updates when the reading lands.</span>
        </div>
      )}
      {open === "scan" && sensor && <ScanPicker entry={entry} req={req} sensor={sensor} />}
      {error && <Callout tone="danger">{error}</Callout>}
    </div>
  );
}

/** Pick a phone scan of this machine to answer the check with, or go and record one. */
function ScanPicker({ entry, req, sensor }: { entry: CaseEntry; req: TestRequest; sensor: string }) {
  const machine = machineOfCase(entry);
  const list = useAsync(() => fetchScans(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const analysed = (list.data ?? []).filter((s) => s.analysed);
  // This machine's scans first; any analysed scan can be offered, the server checks the speed.
  const rows = [...analysed.filter((s) => s.machine === machine.name), ...analysed.filter((s) => s.machine !== machine.name)].slice(0, 6);

  async function use(scanId: string) {
    setBusy(scanId);
    setError(null);
    try {
      const inv = await answerWithScan(entry.id, scanId);
      rememberInvestigation(inv);
      const got = inv.phone_answers?.filter((p) => p.test_id === req.test_id).pop();
      if (got) markAnswered(entry.id, req.test_id, "phone scan", "here", got.value);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="take-panel take-scan">
      <p className="take-note">
        The scan's {sensor} stands in for this check, with an uncertainty worked out from the clip, so it counts for less than a sensor would. Use a clip of {machine.short} running at the case's speed.
      </p>
      {list.error ? (
        <Callout tone="danger">{list.error.message}</Callout>
      ) : !list.data ? (
        <span className="dim small">Loading scans…</span>
      ) : rows.length === 0 ? (
        <span className="dim small">No analysed scan yet.</span>
      ) : (
        <ul className="take-scans">
          {rows.map((s) => (
            <li key={s.id}>
              <span>
                <b>{s.machine || "unnamed machine"}</b> <span className="dim mono tiny">{s.id}</span>
                <span className="dim small"> · {stamp(s.created)}</span>
              </span>
              <Button size="sm" busy={busy === s.id} disabled={busy !== null} onClick={() => use(s.id)}>
                Answer with this scan
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Link className="small" to={scanForCase(machine.name, entry.id)}>
        Record a new scan of {machine.short}
      </Link>
      {error && <Callout tone="danger">{error}</Callout>}
    </div>
  );
}

/** How the axis is drawn at this moment: beliefs, where they stood, who leads. Left out, the case's own state is drawn. */
export type AxisView = {
  beliefs: Record<string, number | null>;
  was?: Record<string, number | null>;
  leader: string | null;
  settled: boolean;
  land: boolean;
};

const beliefsOf = (m: CaseModel) => Object.fromEntries(m.suspects.map((s) => [s.kind, s.belief]));

export function DecisionCard({
  model,
  entry,
  catalogue,
  answer = true,
  view,
  className,
}: {
  model: CaseModel;
  entry: CaseEntry;
  catalogue: CatalogTest[] | null;
  /** Show the ways to take the reading inside the card. A page with its own next-step bar turns this off. */
  answer?: boolean;
  view?: AxisView;
  className?: string;
}) {
  const req = model.lastRequest;
  if (!req) return null;

  const waiting = model.request !== null;
  const cat = catalogue?.find((t) => t.id === req.test_id);
  const chosen = req.considered.find((c) => c.fate === "chosen");
  const answered = model.checks.filter((c) => c.testId === req.test_id && c.status === "answered").pop();
  const mine = entry.answered[req.test_id];
  const phone = entry.inv?.phone_answers?.filter((p) => p.test_id === req.test_id).pop();
  const minutes = cat?.effort_min ?? chosen?.minutes;
  const downtime = cat?.downtime ?? chosen?.downtime;
  const v: AxisView = view ?? { beliefs: beliefsOf(model), leader: model.leader?.kind ?? null, settled: model.status === "concluded", land: false };

  const expected = Object.entries(req.expected_readings)
    .map(([kind, value]) => ({ kind, label: fault(kind).name, value, tone: req.separates.includes(kind) ? "accent" : "muted", faded: !req.separates.includes(kind) }))
    .sort((a, b) => Number(a.faded) - Number(b.faded));

  return (
    <Card
      tone={waiting ? "accent" : undefined}
      className={cx("decision", className)}
      title={waiting ? "The measurement that decides" : answered ? "The measurement that decided" : "The measurement asked for"}
      icon={<Crosshair size={15} />}
      actions={
        <Hint label="How the engine chose this measurement">
          Of the measurements that could settle it, this one tells the most per minute. Each band is what a suspect's simulation predicts the reading will be, give or take the
          measurement's spread (σ {num(req.sigma, 2)}).
        </Hint>
      }
    >
      <div className="decision-top">
        <h3>{check(req.test_id).name}</h3>
        <div className="decision-facts">
          {minutes != null && <Badge>{minutes} min</Badge>}
          {downtime && <Badge>{downtime === "none" ? "machine keeps running" : downtime}</Badge>}
          {chosen?.apart_sigma != null && (
            <span data-tip="How far apart the leaders' predictions sit, in units of the measurement's spread">
              <Badge>{num(chosen.apart_sigma, 1)}σ apart</Badge>
            </span>
          )}
        </div>
      </div>

      <DecisionAxis
        expected={expected}
        sigma={req.sigma}
        reading={answered?.reading ?? null}
        readingLabel="reading"
        beliefs={v.beliefs}
        was={v.was}
        bar={model.concludeAt}
        leader={v.leader}
        settled={v.settled}
        land={v.land}
      />

      {answered && (
        <p className="decision-src">
          {mine?.by === "virtual instrument" ? (
            <>
              <Badge tone="sim" plain>
                simulated
              </Badge>
              Taken by the model's instrument{mine.from === "phone" ? " on a phone" : ""} at {clock(mine.at)}. It answers from the fault it was given.
            </>
          ) : mine?.by === "person" ? (
            <>Typed in by a technician at {clock(mine.at)}.</>
          ) : phone ? (
            <>
              <Badge tone="accent" plain>
                phone scan
              </Badge>
              Read from <Link to={`/lens/${phone.scan_id}`}>scan {phone.scan_id}</Link>, with the uncertainty of a phone clip.
            </>
          ) : (
            <>Reading handed in.</>
          )}
        </p>
      )}

      {waiting && answer && <TakeReading entry={entry} req={req} className="decision-take" />}

      <div className="decision-more">
        {cat && cat.procedure.length > 0 && (
          <Details summary="How to take it">
            <ol className="steps">
              {cat.procedure.map((p) => (
                <li key={p}>
                  <span>{p}</span>
                </li>
              ))}
            </ol>
          </Details>
        )}
        <Details summary="Why this one">
          <Menu considered={req.considered} bare />
        </Details>
      </div>
    </Card>
  );
}

/** Every check the engine weighed, and why each was or was not offered. */
export function Menu({ considered, bare }: { considered: Considered[]; bare?: boolean }) {
  if (considered.length === 0) return null;
  const rows = [...considered].sort((a, b) => (ORDER[a.fate] ?? 9) - (ORDER[b.fate] ?? 9));
  const table = (
    <div className="table-wrap menu-wrap">
      <table className="table compact">
        <thead>
          <tr>
            <th>Check</th>
            <th className="t-num" data-tip="Minutes it takes">
              Min
            </th>
            <th className="t-num" data-tip="How much its answer is expected to tell, in units of information">
              Info
            </th>
            <th className="t-num" data-tip="Information per minute">
              Per min
            </th>
            <th className="t-num" data-tip="The chance its answer brings one suspect to the bar">
              Settles
            </th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.test_id} className={c.fate === "chosen" ? "on" : undefined}>
              <td>
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
  );
  if (bare) return table;
  return (
    <div className="menu-block">
      <div className="row">
        <Scale size={14} className="dim" aria-hidden />
        <h3>Why this check</h3>
      </div>
      {table}
    </div>
  );
}
