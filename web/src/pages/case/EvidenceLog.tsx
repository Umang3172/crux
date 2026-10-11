// Every entry in the case's ledger, in order, with where it came from. The
// entries the stage on screen rests on are marked.

import type { Investigation, LedgerEntry } from "../../api/types";
import { Dialog } from "../../app/Dialog";
import type { CaseEntry } from "../../demo/world";
import type { StageId } from "../../lib/case";
import { useCatalogue } from "../../lib/hooks";
import { SOURCE_LABEL } from "../../lib/plain";
import { SourceTag } from "../../ui/SourceTag";
import l from "./EvidenceLog.module.css";

export function EvidenceLog({
  open,
  onClose,
  inv,
  entry,
  stage,
}: {
  open: boolean;
  onClose: () => void;
  inv: Investigation;
  entry: CaseEntry | undefined;
  stage: StageId;
}) {
  const cat = useCatalogue();
  const cited = new Set(citedBy(inv, stage));
  // A reading this browser took from the pump model is the model's virtual
  // instrument, whatever label the evidence door gave it.
  const instrumentNames = Object.keys(entry?.answered ?? {})
    .map((t) => cat.data?.find((x) => x.id === t)?.name)
    .filter((x): x is string => !!x);
  const sourceOf = (e: LedgerEntry) =>
    instrumentNames.some((n) => e.statement.startsWith(n)) ? "virtual instrument" : SOURCE_LABEL[e.source] ?? e.source;
  return (
    <Dialog open={open} onClose={onClose} title="Evidence log" side>
      <p className={l.lead}>Every entry in the order Crux recorded it. Entries the stage on screen rests on are marked.</p>
      <ol className={l.list}>
        {inv.ledger.map((e) => (
          <li key={e.id} className={cited.has(e.id) ? l.cited : undefined}>
            <span className={l.id}>{e.id}</span>
            <span className={l.statement}>{e.statement}</span>
            <span className={l.value}>
              {String(e.value)} {e.unit}
            </span>
            <SourceTag tone={sourceOf(e) === "virtual instrument" ? "measure" : "plain"}>{sourceOf(e)}</SourceTag>
          </li>
        ))}
      </ol>
    </Dialog>
  );
}

function citedBy(inv: Investigation, stage: StageId): string[] {
  switch (stage) {
    case "reading":
      return inv.ledger.filter((e) => e.source === "sensor" || e.source === "physics").map((e) => e.id);
    case "experiments":
      return inv.ledger.filter((e) => e.source === "virtual_experiment").map((e) => e.id);
    case "check":
      return inv.ledger.filter((e) => /requested measurement/.test(e.statement) || /:/.test(e.statement)).map((e) => e.id);
    case "answer":
      return inv.conclusion?.evidence_ids ?? [];
    default:
      return [];
  }
}
