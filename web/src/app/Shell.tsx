import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { Building2, Menu, Moon, Plus, Search, ShieldAlert, Sun } from "lucide-react";
import { onWaking } from "../api/client";
import { brainOf } from "../lib/ai";
import { modelOf } from "../lib/casemodel";
import { shortId } from "../lib/format";
import { useHealth, useHotkey, useTheme } from "../lib/hooks";
import { PLANT_NAME } from "../lib/scenarios";
import { openHazards, patchCase, useSession } from "../lib/session";
import { Button, cx } from "../ui/kit";
import { CommandPalette } from "./CommandPalette";
import { Launcher, openLauncher } from "./Launcher";
import { NAV } from "./nav";
import "./shell.css";

function Mark() {
  // The crux: two lines of evidence crossing at the one point that decides.
  return (
    <span className="brand-mark" aria-hidden>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M3 3l10 10M13 3L3 13" />
        <circle cx="8" cy="8" r="2.1" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

export function Shell() {
  const health = useHealth();
  const session = useSession();
  const location = useLocation();
  const [theme, toggleTheme] = useTheme();
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [waking, setWaking] = useState(false);

  useEffect(() => onWaking(setWaking), []);
  useEffect(() => {
    setDrawer(false);
    const here = NAV.flatMap((g) => g.items).find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)));
    document.title = here ? `${here.label} · Crux` : "Crux";
    // A new page starts at its top, wherever the last one was scrolled to.
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useHotkey(
    (e) => (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k",
    () => setPalette((p) => !p),
  );

  const brain = brainOf(health.data?.models.investigator);
  const waitingCount = session.cases.filter((c) => modelOf(c)?.status === "waiting").length;
  const hazards = openHazards(session);

  return (
    <div className="app">
      {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}
      <aside className={cx("side", drawer && "open")}>
        <Link to="/" className="brand" aria-label="Crux console, overview">
          <Mark />
          Crux <em>Console</em>
        </Link>
        <div className="plant">
          <Building2 size={16} aria-hidden />
          <div className="grow">
            <b className="truncate">{PLANT_NAME}</b>
            <span className="dim">Demo data, labelled where it shows</span>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {NAV.map((g) => (
            <div className="nav-group" key={g.group}>
              <span>{g.group}</span>
              {g.items.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "on" : undefined)}>
                  <n.icon size={16} aria-hidden />
                  {n.label}
                  {n.to === "/cases" && session.cases.length > 0 && (
                    <span className={cx("nav-count", waitingCount > 0 && "warn")} title={waitingCount > 0 ? `${waitingCount} waiting for a measurement` : "Cases in this browser"}>
                      {waitingCount > 0 ? waitingCount : session.cases.length}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <Link to="/system" className="ai-pill" title="Which model runs each job">
            <span className={cx("ai-dot", brain.live && "live")} aria-hidden />
            <span className="grow">
              <small>Agents run on</small>
              <b className="truncate">{health.data ? brain.name : health.error ? "engine unreachable" : "…"}</b>
            </span>
          </Link>
        </div>
      </aside>

      <div className="main">
        <header className="top">
          <Button className="menu-btn" variant="ghost" icon={<Menu size={18} />} onClick={() => setDrawer(true)} aria-label="Open the menu" />
          <button type="button" className="search" onClick={() => setPalette(true)}>
            <Search size={15} aria-hidden />
            <span>Search or run a command</span>
            <span className="kbd">⌘K</span>
          </button>
          <div className="row push">
            <Button variant="ghost" icon={theme === "dark" ? <Sun size={16} /> : <Moon size={16} />} onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"} />
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => openLauncher()}>
              New case
            </Button>
          </div>
        </header>
        {waking && (
          <>
            <div className="progress" />
            <div className="waking" role="status">
              Waking the engine. The first request after a quiet spell takes a few seconds.
            </div>
          </>
        )}
        {hazards.map((h) => (
          <HazardBanner key={h.id} id={h.id} text={h.text} />
        ))}
        <main className="content">
          <Outlet />
        </main>
      </div>

      <Launcher />
      <CommandPalette open={palette} onClose={() => setPalette(false)} onTheme={toggleTheme} />
    </div>
  );
}

/** A hazard someone reported stays on top of every page until a person puts their name to it. */
function HazardBanner({ id, text }: { id: string; text: string }) {
  const [by, setBy] = useState("");
  return (
    <div className="banner" role="alert">
      <ShieldAlert size={18} aria-hidden />
      <div className="grow">
        <b>Hazard reported on case {shortId(id)}.</b> {text}
      </div>
      <Link to={`/cases/${id}`} className="btn btn-sm">
        Open the case
      </Link>
      <input className="input input-sm" placeholder="Your name" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Your name, to acknowledge the hazard" />
      <Button size="sm" variant="danger" disabled={!by.trim()} onClick={() => patchCase(id, { hazardAck: { by: by.trim(), at: Date.now() } })}>
        Acknowledge
      </Button>
    </div>
  );
}
