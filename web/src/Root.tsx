/**
 * The page: one header, two ways in.
 *
 * "Guided" walks anyone through a case on the cooling pump in plain words.
 * "Engineer view" is the full engine trace: beliefs, spectra and the ledger.
 * Both run the same engine through the same endpoints.
 */

import { useEffect, useState } from "react";
import App from "./App";
import { health } from "./api";
import { Guided } from "./guided/Guided";
import "./guided/guided.css";

type View = "guided" | "engineer";

function initialView(): View {
  return window.location.hash === "#engineer" ? "engineer" : "guided";
}

export function Root() {
  const [view, setView] = useState<View>(initialView);
  const [models, setModels] = useState<Record<string, string>>({});
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    health()
      .then((h) => {
        setModels(h.models);
        setOnline(true);
      })
      .catch(() => setOnline(false));
  }, []);

  const choose = (v: View) => {
    setView(v);
    window.history.replaceState(null, "", v === "engineer" ? "#engineer" : "#");
  };

  return (
    <div className="shell">
      <header className="topbar">
        <span className="wordmark">Crux</span>
        <span className="tagline">MechNova · the one measurement that decides</span>
        <nav className="g-views" aria-label="View">
          <button aria-pressed={view === "guided"} onClick={() => choose("guided")}>
            Guided
          </button>
          <button aria-pressed={view === "engineer"} onClick={() => choose("engineer")}>
            Engineer view
          </button>
        </nav>
        <span className="models">
          <span className={`dot${online === false ? " down" : ""}`} />
          {online === false
            ? "engine unreachable"
            : Object.entries(models)
                .map(([k, v]) => `${k}=${v}`)
                .join("  ") || "…"}
        </span>
      </header>
      {view === "guided" ? <Guided /> : <App embedded />}
    </div>
  );
}
