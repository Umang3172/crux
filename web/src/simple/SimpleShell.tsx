// The frame of the simple view: a name, three links, the page, a footer line.
// The page is always light; the console keeps the theme its visitor chose.

import { useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { applyStoredTheme, useHealth } from "../lib/hooks";
import "./simple.css";

function aiLine(models: Record<string, string> | undefined) {
  if (!models) return "Crux's AI: checking";
  const live = Object.values(models).some((v) => v.startsWith("gemini"));
  return live ? "Crux's AI: Gemini on Google Cloud" : "Crux's AI: offline stand-in";
}

export default function SimpleShell() {
  const health = useHealth();
  const { pathname } = useLocation();

  useEffect(() => {
    document.documentElement.dataset.theme = "light";
    return () => applyStoredTheme();
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="mn">
      <header className="mn-top">
        <div className="mn-wrap">
          <NavLink to="/" className="mn-brand" aria-label="Crux, home">
            <span className="mn-mark" aria-hidden>
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path d="M2 2l8 8M10 2L2 10" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            Crux
          </NavLink>
          <nav className="mn-nav" aria-label="Main">
            <NavLink to="/" end>
              Machines
            </NavLink>
            <NavLink to="/how">How it works</NavLink>
            <NavLink to="/console">
              <span className="mn-hide-sm">Full console</span>
              <span className="mn-show-sm">Console</span>
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="mn-main">
        <Outlet />
      </main>

      <footer className="mn-foot">
        <div className="mn-wrap">
          <span>A demo plant. Readings come from a physics model of each machine.</span>
          <span>{aiLine(health.data?.models)}</span>
        </div>
      </footer>
    </div>
  );
}
