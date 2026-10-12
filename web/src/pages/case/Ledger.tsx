// The evidence ledger: every entry the case rests on, in the order it was
// written, with where each came from.

import { useEffect, useRef, useState } from "react";
import { Database } from "lucide-react";
import type { CaseModel } from "../../lib/casemodel";
import { num } from "../../lib/format";
import { plainSentence } from "../../lib/plain";
import { Badge, Card, Seg, cx, type Tone } from "../../ui/kit";

export const SOURCE: Record<string, { label: string; tone: Tone }> = {
  sensor: { label: "sensor", tone: "neutral" },
  physics: { label: "physics", tone: "accent" },
  virtual_experiment: { label: "virtual experiment", tone: "sim" },
  human_measurement: { label: "person", tone: "ok" },
};

type Filter = "all" | "sensor" | "physics" | "virtual_experiment" | "human_measurement";

export function LedgerCard({ model, cited }: { model: CaseModel; cited: string[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const body = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    if (cited.length === 0) return;
    setFilter("all");
    // Wait for the filter to render before looking for the row.
    const t = window.setTimeout(() => body.current?.querySelector("tr.on")?.scrollIntoView({ block: "center", behavior: "smooth" }), 30);
    return () => window.clearTimeout(t);
  }, [cited]);

  const rows = model.ledger.filter((l) => filter === "all" || l.source === filter);
  const count = (s: string) => model.ledger.filter((l) => l.source === s).length;

  return (
    <Card
      id="ledger"
      title="Evidence ledger"
      icon={<Database size={15} />}
      sub={`${model.ledger.length} entries, append-only`}
      flush
      actions={
        <Seg
          value={filter}
          onChange={setFilter}
          label="Filter by source"
          options={[
            { id: "all", label: "All" },
            { id: "sensor", label: `Sensor ${count("sensor")}` },
            { id: "physics", label: `Physics ${count("physics")}` },
            { id: "virtual_experiment", label: `Experiments ${count("virtual_experiment")}` },
            { id: "human_measurement", label: `People ${count("human_measurement")}` },
          ]}
        />
      }
    >
      <div className="table-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
        <table className="table compact">
          <thead>
            <tr>
              <th style={{ width: 58 }}>Id</th>
              <th>Statement</th>
              <th className="t-num">Value</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody ref={body}>
            {rows.map((l) => {
              const src = SOURCE[l.source] ?? { label: l.source, tone: "neutral" as Tone };
              return (
                <tr key={l.id} className={cx("hover", cited.includes(l.id) && "on")}>
                  <td>
                    <span className={cx("chip", cited.includes(l.id) && "on")}>{l.id}</span>
                  </td>
                  <td>{plainSentence(l.statement)}</td>
                  <td className="t-num mono">
                    {typeof l.value === "number" ? num(l.value, Math.abs(l.value) >= 100 ? 1 : 2) : (l.value ?? "–")}
                    <span className="dim">{l.unit}</span>
                  </td>
                  <td>
                    <Badge tone={src.tone} plain>
                      {src.label}
                    </Badge>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="dim-cell">
                  No entry from this source.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
