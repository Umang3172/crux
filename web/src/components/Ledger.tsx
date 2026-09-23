/**
 * The evidence ledger, as a timeline that only ever grows.
 *
 * This is the trust story, so it gets the height and it never re-sorts,
 * re-numbers or collapses: `E07` means the same thing at the end of the case as
 * it did when it was written. The tint says where a claim came from, which is
 * the question a reliability engineer asks first — did a sensor see this, did
 * the model predict it, or did somebody go and measure it?
 */

import { useEffect, useRef } from "react";
import { LedgerEntry } from "../api";

const SOURCES: Record<string, { colour: string; short: string }> = {
  sensor: { colour: "var(--sensor)", short: "sensor" },
  physics: { colour: "var(--physics)", short: "physics" },
  virtual_experiment: { colour: "var(--sim)", short: "simulated" },
  human_measurement: { colour: "var(--human)", short: "human" },
  operator: { colour: "var(--human)", short: "operator" },
};

function fallback(source: string) {
  return { colour: "var(--ink-faint)", short: source };
}

export function Ledger({ entries }: { entries: LedgerEntry[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const previous = useRef(0);

  // Follow the newest entry once the list is growing, so an append is something
  // you watch happen. The first batch is left alone: a case starts by being read
  // from the top.
  useEffect(() => {
    const el = scroller.current;
    if (el && previous.current > 0 && entries.length > previous.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
    previous.current = entries.length;
  }, [entries.length]);

  return (
    <section className="panel">
      <header>
        <h2>Evidence ledger</h2>
        <span className="note">
          {entries.length} {entries.length === 1 ? "entry" : "entries"} · append-only
        </span>
      </header>
      {entries.length === 0 && <p className="empty">Nothing observed yet.</p>}
      <div className="ledger" ref={scroller}>
        {entries.map((e, i) => {
          const kind = SOURCES[e.source] ?? fallback(e.source);
          return (
            <div
              key={e.id}
              className="ledger-item"
              style={{ animationDelay: `${Math.min(i, 12) * 45}ms` }}
            >
              <span className="ledger-dot" style={{ background: kind.colour }} />
              <div className="ledger-head">
                <span className="ledger-id">{e.id}</span>
                <span className="ledger-src" style={{ color: kind.colour }}>
                  {kind.short}
                </span>
              </div>
              <div className="ledger-body">
                {e.statement}
                {e.value !== null && (
                  <>
                    {" "}
                    <span className="ledger-value">
                      {e.value}
                      {e.unit}
                    </span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
