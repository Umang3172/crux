/**
 * The investigation view.
 *
 * Skeleton, on purpose: lane C replaces the blocks with the real thing (the
 * hypothesis constellation, real-vs-simulated spectra, the animated ledger).
 * What it already proves is the loop — start a case, watch beliefs move, read
 * the evidence.
 */

import { useEffect, useState } from "react";
import { Investigation, health, replay } from "./api";

const FAULTS = ["imbalance", "misalignment", "looseness", "outer_race", "inner_race"];

export default function App() {
  const [models, setModels] = useState<Record<string, string>>({});
  const [inv, setInv] = useState<Investigation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    health()
      .then((h) => setModels(h.models))
      .catch(() => setError("API not reachable — is `hypengine serve` running?"));
  }, []);

  async function run(fault: string) {
    setBusy(true);
    setError(null);
    try {
      setInv(await replay(fault));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ fontFamily: "ui-sans-serif, system-ui", padding: 32, maxWidth: 1100 }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 32 }}>Hypothesis Engine</h1>
        <p style={{ color: "#4a5157" }}>
          MechNova · models: {Object.entries(models).map(([k, v]) => `${k}=${v}`).join(", ") || "…"}
        </p>
      </header>

      <section style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
        {FAULTS.map((f) => (
          <button key={f} onClick={() => run(f)} disabled={busy} style={button}>
            induce {f.replace("_", " ")}
          </button>
        ))}
      </section>

      {error && <p style={{ color: "#a8420c" }}>{error}</p>}
      {busy && <p>investigating…</p>}

      {inv && (
        <>
          <Panel title="Transcript">
            {inv.transcript.map((line, i) => (
              <p key={i} style={{ margin: "6px 0" }}>
                {line}
              </p>
            ))}
          </Panel>

          <Panel title="Hypotheses">
            {inv.hypotheses.map((h) => (
              <div key={h.kind} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 150, opacity: h.rejected ? 0.45 : 1 }}>{h.label}</span>
                <span style={{ flex: 1, background: "#e7e7e1", height: 14, borderRadius: 7 }}>
                  <span
                    style={{
                      display: "block",
                      width: `${Math.round(h.posterior * 100)}%`,
                      height: 14,
                      borderRadius: 7,
                      background: h.rejected ? "#b9c4c9" : "#a8420c",
                      transition: "width .6s",
                    }}
                  />
                </span>
                <span style={{ width: 120, textAlign: "right" }}>
                  {(h.posterior * 100).toFixed(1)}%
                  {h.correlation !== null && ` · r=${h.correlation.toFixed(2)}`}
                </span>
              </div>
            ))}
          </Panel>

          <Panel title="Evidence ledger">
            {inv.ledger.map((e) => (
              <p key={e.id} style={{ margin: "4px 0", fontFamily: "ui-monospace, monospace" }}>
                {e.id} · {e.statement}
                {e.value !== null && ` = ${e.value}${e.unit}`} · <i>{e.source}</i>
              </p>
            ))}
          </Panel>

          {inv.conclusion && (
            <Panel title="Conclusion">
              <p style={{ fontSize: 20, fontWeight: 600 }}>
                {inv.conclusion.root_cause.replace("_", " ")} ·{" "}
                {(inv.conclusion.confidence * 100).toFixed(0)}%
              </p>
              <p>{inv.conclusion.reasoning}</p>
              <p>
                <b>Action:</b> {inv.conclusion.recommended_action}
              </p>
              <p>
                <b>What would change my mind:</b> {inv.conclusion.what_would_change_my_mind}
              </p>
            </Panel>
          )}
        </>
      )}
    </main>
  );
}

const button: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px solid #dad9d0",
  background: "#fbfbf8",
  cursor: "pointer",
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        border: "1px solid #dad9d0",
        borderRadius: 16,
        padding: 24,
        marginBottom: 20,
        background: "#fbfbf8",
      }}
    >
      <h2 style={{ marginTop: 0, fontSize: 18, letterSpacing: 1, color: "#a8420c" }}>
        {title.toUpperCase()}
      </h2>
      {children}
    </section>
  );
}
