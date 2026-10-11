// What a citation chip shows: the statement the sentence rests on and where it
// came from. The server labels the demo pump's readings by how they were handed
// in; the true source comes from what this browser recorded about who answered.

import type { CatalogTest, Note, Report, Ticket } from "../../api/types";
import type { CaseEntry } from "../../demo/world";
import { plainSentence } from "../../lib/plain";
import { recordingSource } from "./model";

export type Cited = { id: string; statement: string; source: string };
export type Lookup = (id: string) => Cited | null;

const KIND: Record<string, string> = {
  physics: "physics model",
  virtual_experiment: "virtual experiment",
  human_measurement: "person",
  engine: "the engine",
  status: "the engine",
  record: "record",
  camera: "camera",
  lesson: "an earlier repair",
};

function readingSource(statement: string, kind: string, entry: CaseEntry | undefined, catalogue: CatalogTest[] | null): string {
  const test = catalogue?.find((t) => statement.startsWith(t.name));
  const by = test && entry?.answered[test.id]?.by;
  if (by === "virtual instrument") return "the pump model's virtual instrument · synthetic";
  if (by === "person") return "person";
  if (by === "live sensor") return "live sensor";
  return kind === "human_measurement" ? "person" : "capture from the pump model · synthetic";
}

/** Citations in a demo-pump case's report: ledger entries, and the person's notes. */
export function caseLookup(evidence: Report["evidence"], notes: Note[], entry: CaseEntry | undefined, catalogue: CatalogTest[] | null): Lookup {
  const entries = new Map(evidence.map((e) => [e.id, e]));
  const noted = new Map(notes.map((n) => [n.id, n]));
  return (id) => {
    const e = entries.get(id);
    if (e) {
      const reading = e.kind === "sensor" || e.kind === "human_measurement";
      const source = reading ? readingSource(e.statement, e.kind, entry, catalogue) : (KIND[e.kind] ?? e.kind);
      return { id, statement: plainSentence(e.statement), source };
    }
    const n = noted.get(id);
    return n ? { id, statement: `“${n.text}”`, source: `a note by ${n.by}: not evidence, it moved nothing` } : null;
  };
}

/** Citations in a ticket: its own evidence list, each kind named for where this run came from. */
export function ticketLookup(ticket: Ticket): Lookup {
  const entries = new Map(ticket.evidence.map((e) => [e.id, e]));
  const run = recordingSource(ticket.machine).tag;
  const label = (kind: string) => (kind === "sensor" ? run : kind === "forecast" ? `forecast · ${run}` : (KIND[kind] ?? kind));
  return (id) => {
    const e = entries.get(id);
    return e ? { id, statement: plainSentence(e.statement), source: label(e.kind) } : null;
  };
}
