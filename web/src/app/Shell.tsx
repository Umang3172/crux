import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { onWaking } from "../api/client";
import { fleetStatus } from "../api/crux";
import { resetDemo } from "../demo/world";
import { PLANT_NAME } from "../demo/stories";
import { useAsync, useHealth } from "../lib/hooks";
import { brainOf } from "./ai";
import { AIStatusDrawer } from "./AIStatusDrawer";
import { DataNoteProvider, useNoteText } from "./DataNote";
import { GuideDialog } from "./GuideDialog";
import { HazardBanner } from "./HazardBanner";
import s from "./Shell.module.css";

export function Shell() {
  return (
    <DataNoteProvider>
      <Frame />
    </DataNoteProvider>
  );
}

function Frame() {
  const navigate = useNavigate();
  const health = useHealth();
  const hub = useAsync(() => fleetStatus(), []);
  const [waking, setWaking] = useState(false);
  const [guide, setGuide] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const note = useNoteText();

  useEffect(() => onWaking(setWaking), []);

  const brain = brainOf(health.data?.models.investigator);
  // The network page needs a hub to learn from; without one it stays out of the way.
  const hasHub = (hub.data?.hub_versions.length ?? 0) > 0;

  function reset() {
    if (!window.confirm("Start a fresh demo? This browser forgets its cases and work orders.")) return;
    resetDemo();
    navigate("/");
  }

  return (
    <div className={s.app}>
      <HazardBanner />
      <header className={s.header}>
        <Link to="/" className={s.brand} aria-label="Crux, home">
          <span className={s.word}>Crux</span>
          <span className={s.tagline}>the one measurement that decides</span>
        </Link>
        <span className={s.plant}>{PLANT_NAME}</span>
        <nav className={s.nav} aria-label="Main">
          <NavLink to="/" end className={({ isActive }) => (isActive ? s.active : undefined)}>
            Plant
          </NavLink>
          <NavLink to="/work-orders" className={({ isActive }) => (isActive ? s.active : undefined)}>
            Work orders
          </NavLink>
          <NavLink to="/proof" className={({ isActive }) => (isActive ? s.active : undefined)}>
            Proof
          </NavLink>
          {hasHub && (
            <NavLink to="/network" className={({ isActive }) => (isActive ? s.active : undefined)}>
              Network
            </NavLink>
          )}
          <NavLink to="/scans" className={({ isActive }) => (isActive ? s.active : undefined)}>
            Lens scans
          </NavLink>
          <NavLink to="/how" className={({ isActive }) => (isActive ? s.active : undefined)}>
            How it works
          </NavLink>
        </nav>
        <div className={s.tools}>
          <button type="button" className={s.badge} onClick={() => setDrawer(true)} aria-haspopup="dialog">
            <span className={brain.live ? s.dotLive : s.dot} aria-hidden="true" />
            <span className={s.long}>Investigator: </span>
            {health.data ? brain.name : "…"}
          </button>
          <button type="button" className={s.button} onClick={() => setGuide(true)} aria-haspopup="dialog">
            Guide
          </button>
          <button type="button" className={s.quiet} onClick={reset}>
            Reset demo
          </button>
        </div>
      </header>
      {waking && (
        <div className={s.waking} role="status">
          Waking the engine… the first request after a quiet spell takes a few seconds.
        </div>
      )}
      <main className={s.main}>
        <Outlet />
      </main>
      <footer className={s.note}>{note}</footer>
      <GuideDialog open={guide} onClose={() => setGuide(false)} />
      <AIStatusDrawer open={drawer} onClose={() => setDrawer(false)} />
    </div>
  );
}
