/**
 * The page: one header, and a tab for each way in.
 *
 * "Guided" walks anyone through a case on the cooling pump in plain words.
 * "Investigator" shows a language model working a case through the tools.
 * "Engineer view" is the full engine trace: beliefs, spectra and the ledger.
 * All three run the same engine through the same endpoints.
 */

import { useEffect, useState } from "react";
import App from "./App";
import { health } from "./api";
import { Guided } from "./guided/Guided";
import "./guided/guided.css";
import { DIAGRAMS } from "./how/diagrams";
import { HowItWorks } from "./how/HowItWorks";
import { Investigator } from "./investigator/Investigator";
import { Lens } from "./lens/Lens";
import { Maintenance } from "./maintenance/Maintenance";

type View = "guided" | "investigator" | "engineer" | "maintenance" | "lens";

const VIEWS: View[] = ["guided", "investigator", "engineer", "maintenance", "lens"];

function initialView(): View {
  const hash = window.location.hash.slice(1) as View;
  return VIEWS.includes(hash) ? hash : "guided";
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
    window.history.replaceState(null, "", v === "guided" ? "#" : `#${v}`);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <span className="wordmark">Crux</span>
        <span className="tagline">The one measurement that decides</span>
        <nav className="g-views" aria-label="View">
          <button aria-pressed={view === "guided"} onClick={() => choose("guided")}>
            Guided
          </button>
          <button aria-pressed={view === "investigator"} onClick={() => choose("investigator")}>
            Investigator
          </button>
          <button aria-pressed={view === "engineer"} onClick={() => choose("engineer")}>
            Engineer view
          </button>
          <button aria-pressed={view === "maintenance"} onClick={() => choose("maintenance")}>
            Predictive maintenance
          </button>
          <button aria-pressed={view === "lens"} onClick={() => choose("lens")}>
            Lens
          </button>
        </nav>
        <span
          className="models"
          title={Object.entries(models)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")}
        >
          <span className={`dot${online === false ? " down" : ""}`} />
          {online === null
            ? "Connecting"
            : online === false
              ? "Engine unreachable"
              : Object.values(models).some((v) => v.startsWith("gemini"))
                ? "Engine ready, Gemini on"
                : Object.values(models).some((v) => v.startsWith("ollama"))
                  ? "Engine ready, local model on"
                  : "Engine ready, Gemini off"}
        </span>
      </header>
      <HowItWorks id={view} diagram={DIAGRAMS[view]} />
      {view === "guided" ? (
        <Guided />
      ) : view === "investigator" ? (
        <Investigator />
      ) : view === "maintenance" ? (
        <Maintenance />
      ) : view === "lens" ? (
        <Lens />
      ) : (
        <App embedded />
      )}
    </div>
  );
}
