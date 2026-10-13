// The side of an investigation: what is remembered about this machine, what
// people wrote down, the measurements taken, and the facts of the investigation.

import { useState } from "react";
import { Eye, History, MessageSquare, Ruler, Settings2 } from "lucide-react";
import { addNote } from "../../api/crux";
import type { CaseModel } from "../../lib/casemodel";
import { num, signed, stamp } from "../../lib/format";
import { fault } from "../../lib/plain";
import { floorLabel, scenario, severityLabel } from "../../lib/scenarios";
import { getSession, patchCase, rememberInvestigation, type CaseEntry } from "../../lib/session";
import { Badge, Button, Callout, Card, Empty, Hint, SourceTag, toast } from "../../ui/kit";

export function MemoryCard({ model }: { model: CaseModel }) {
  return (
    <Card
      title="Earlier on this machine"
      icon={<History size={15} />}
      flush
      actions={<Hint label="About earlier investigations">Shown to people and to Crux's AI. A record is never evidence and never moves a belief.</Hint>}
    >
      {model.history.length === 0 ? (
        <Empty left title="No earlier investigation" />
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
              {c.by && <> · {c.by === "replay" ? "by the model's instrument (simulated)" : `by ${c.by}`}</>}
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

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const inv = await addNote(entry.id, text.trim(), by.trim() || "someone on site");
      if (entry.kind === "engine") rememberInvestigation(inv);
      else if (entry.run?.case) {
        // An AI investigation is kept in this browser; its notes and hazard flag are brought up to date from the server's answer.
        patchCase(entry.id, { run: { ...entry.run, case: { ...entry.run.case, notes: inv.notes, hazard: inv.hazard } } });
      }
      // A newly reported hazard needs a new acknowledgement.
      const raised = !!inv.hazard && inv.hazard !== model.hazard;
      if (raised) patchCase(entry.id, { hazardAck: undefined });
      setText("");
      toast(raised ? "Hazard flagged for a person" : "Note kept. No belief moved.", raised ? "danger" : "ok");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="notes" title="Notes" icon={<MessageSquare size={15} />} flush>
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
      <form
        className="col notes-form"
        style={{ borderTop: model.notes.length ? "1px solid var(--line)" : undefined }}
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void add();
        }}
      >
        <textarea className="textarea" value={text} maxLength={600} onChange={(e) => setText(e.target.value)} placeholder="What you saw, heard or smelt" aria-label="A note" />
        <div className="row">
          <input className="input" placeholder="Your name" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Your name, for the note" />
          <Button type="submit" busy={busy} disabled={!text.trim() || entry.lost}>
            Add note
          </Button>
        </div>
        {error && <Callout tone="danger">{error}</Callout>}
        <span className="small dim">Not evidence. A note about a hazard raises a flag.</span>
      </form>
    </Card>
  );
}

export function RunCard({ entry, model }: { entry: CaseEntry; model: CaseModel }) {
  const p = entry.params;
  const sc = scenario(entry.scenario);
  return (
    <Card
      title="This investigation"
      icon={<Settings2 size={15} />}
      actions={
        <>
          <SourceTag source="synthetic" />
          <Hint label="About these facts">This machine is a model: a fault is fed in and its readings are synthetic. What was fed in is an answer key, so it stays hidden until someone asks.</Hint>
        </>
      }
    >
      <dl className="defs">
        <dt>Id</dt>
        <dd className="mono">{entry.id}</dd>
        <dt>Opened</dt>
        <dd>{stamp(entry.createdAt)}</dd>
        <dt>By</dt>
        <dd>{entry.kind === "agents" ? "Crux's AI, nobody answering" : "the engine, a technician answering"}</dd>
        {sc && (
          <>
            <dt>Guided</dt>
            <dd>{sc.title}</dd>
          </>
        )}
        {entry.batch && (
          <>
            <dt>From</dt>
            <dd>a simulated shift</dd>
          </>
        )}
        <dt>Shaft speed</dt>
        <dd className="num">{num(model.rpm, 0)} rpm</dd>
        <dt>Reading</dt>
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
    </Card>
  );
}
