// The side rail of a case: what is remembered about this machine, what people
// wrote down, the measurements taken, and how the case was run.

import { useState } from "react";
import { Eye, History, MessageSquare, Ruler, Settings2 } from "lucide-react";
import { addNote } from "../../api/crux";
import type { CaseModel } from "../../lib/casemodel";
import { num, signed, stamp } from "../../lib/format";
import { fault } from "../../lib/plain";
import { floorLabel, severityLabel } from "../../lib/scenarios";
import { getSession, patchCase, rememberInvestigation, type CaseEntry } from "../../lib/session";
import { Badge, Button, Callout, Card, Empty } from "../../ui/kit";

export function MemoryCard({ model }: { model: CaseModel }) {
  return (
    <Card title="Earlier cases on this pump" icon={<History size={15} />} flush foot="Shown to people and to the agents. A record is never evidence and never changes a belief.">
      {model.history.length === 0 ? (
        <Empty left title="No earlier case">
          This is the first case on this pump in this session.
        </Empty>
      ) : (
        <ul className="list">
          {model.history.map((h) => (
            <li key={h.case_id}>
              <div>{h.sentence}</div>
              <div className="small dim" style={{ marginTop: 2 }}>
                {stamp(h.closed_at)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ChecksCard({ model }: { model: CaseModel }) {
  if (model.checks.length === 0) return null;
  return (
    <Card title="Measurements" icon={<Ruler size={15} />} flush>
      <ul className="list">
        {model.checks.map((c, i) => (
          <li key={i}>
            <div className="row between">
              <b>{c.name}</b>
              <Badge tone={c.status === "answered" ? "ok" : c.status === "waiting" ? "warn" : "neutral"}>{c.status}</Badge>
            </div>
            <div className="small muted" style={{ marginTop: 2 }}>
              {c.reading !== null ? (
                <>
                  read <b className="num">{signed(c.reading, 2)}</b>
                </>
              ) : (
                "no reading yet"
              )}
              {c.by && <> · {c.by === "replay" ? "answered by the pump model's instrument" : `taken by ${c.by}`}</>}
              {c.minutes !== null && <> · {c.minutes} min</>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function NotesCard({ entry, model }: { entry: CaseEntry; model: CaseModel }) {
  const [text, setText] = useState("");
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState(false);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const inv = await addNote(entry.id, text.trim(), by.trim() || "someone on site");
      if (entry.kind === "engine") rememberInvestigation(inv);
      else if (entry.run?.case) {
        // An agent run is kept in this browser; its notes and hazard flag are brought up to date from the server's answer.
        patchCase(entry.id, { run: { ...entry.run, case: { ...entry.run.case, notes: inv.notes, hazard: inv.hazard } } });
      }
      // A newly reported hazard needs a new acknowledgement.
      if (inv.hazard && inv.hazard !== model.hazard) patchCase(entry.id, { hazardAck: undefined });
      setText("");
      setKept(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Notes" icon={<MessageSquare size={15} />} sub="what someone saw, heard or smelt" flush>
      {model.notes.map((n) => (
        <div className="note" key={n.id}>
          <div>{n.text}</div>
          <div className="row gap-1 row-wrap small dim" style={{ marginTop: 3 }}>
            <span>{n.by}</span>
            {n.at && <span>· {stamp(n.at)}</span>}
            {n.hazards.map((h) => (
              <Badge key={h} tone="danger">
                {h}
              </Badge>
            ))}
          </div>
        </div>
      ))}
      <div className="col" style={{ padding: 16, borderTop: model.notes.length ? "1px solid var(--line)" : undefined }}>
        <textarea
          className="textarea"
          value={text}
          maxLength={600}
          onChange={(e) => {
            setText(e.target.value);
            setKept(false);
          }}
          placeholder="Add a note. It is kept and shown; it is not evidence."
          aria-label="A note"
        />
        <div className="row">
          <input className="input" placeholder="Your name" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Your name, for the note" />
          <Button busy={busy} disabled={!text.trim() || entry.lost} onClick={add}>
            Add note
          </Button>
        </div>
        {kept && <span className="small t-ok">Kept. Not evidence: no belief moved.</span>}
        {error && <Callout tone="danger">{error}</Callout>}
        <span className="small dim">A note that describes a hazard raises a flag for a person. Crux does not assess hazards; it passes them on.</span>
      </div>
    </Card>
  );
}

export function RunCard({ entry, model }: { entry: CaseEntry; model: CaseModel }) {
  const p = entry.params;
  return (
    <Card title="This run" icon={<Settings2 size={15} />}>
      <dl className="defs">
        <dt>Case</dt>
        <dd className="mono">{entry.id}</dd>
        <dt>Opened</dt>
        <dd>{stamp(entry.createdAt)}</dd>
        <dt>Investigated by</dt>
        <dd>{entry.kind === "agents" ? "the agents, with nobody answering" : "the engine, with a person answering"}</dd>
        <dt>Shaft speed</dt>
        <dd className="num">{num(model.rpm, 0)} rpm</dd>
        <dt>Capture</dt>
        <dd>
          {severityLabel(p.severity)} · {floorLabel(p.extra_noise)} · seed <span className="mono">{p.seed}</span>
        </dd>
        <dt>Fed in</dt>
        <dd>
          {entry.revealed ? (
            <b>{fault(p.fault).name}</b>
          ) : (
            <span className="row row-wrap">
              <span className="dim">hidden</span>
              <Button size="sm" icon={<Eye size={12} />} onClick={() => patchCase(entry.id, { revealed: true })}>
                Reveal
              </Button>
            </span>
          )}
        </dd>
        <dt>Session</dt>
        <dd className="mono small">{getSession().plant}</dd>
      </dl>
      <p className="small dim" style={{ marginTop: 12 }}>
        The pump is a physics model: the fault is fed in and its readings are synthetic. What was fed in is an answer key, so it stays hidden until someone asks.
      </p>
    </Card>
  );
}
