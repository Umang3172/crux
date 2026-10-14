import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, Outlet, useLocation, useNavigate, useNavigation } from "react-router";
import { Building2, Compass, Menu, Moon, Plus, Search, ShieldAlert, Sun } from "lucide-react";
import { onWaking } from "../api/client";
import { brainOf } from "../lib/ai";
import { modelOf } from "../lib/casemodel";
import { useHealth, useTheme } from "../lib/hooks";
import { SITE, machineOfCase } from "../lib/plant";
import { ROLES, setRole, useRole } from "../lib/role";
import { openHazards, patchCase, useSession } from "../lib/session";
import { Button, CountUp, Hint, Toasts, cx, toast } from "../ui/kit";
import { CommandPalette } from "./CommandPalette";
import { GoHint, MOD_KEY, ShortcutsDialog, useShortcuts } from "./keys";
import { Launcher, openLauncher } from "./Launcher";
import { Tour } from "../tour/Tour";
import { beginTour } from "../tour/steps";
import { LivePill } from "./LiveNow";
import { isHere, navFor } from "./nav";
import { preloadPages } from "./pages";
import "../styles/plant.css";
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
  const navigation = useNavigation();
  const navigate = useNavigate();
  const role = useRole();
  const nav = navFor(role);
  const [theme, toggleTheme] = useTheme();
  const [palette, setPalette] = useState(false);
  const [keys, setKeys] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [waking, setWaking] = useState(false);
  const togglePalette = useCallback(() => setPalette((p) => !p), []);
  const closePalette = useCallback(() => setPalette(false), []);
  const closeKeys = useCallback(() => setKeys(false), []);
  const waitingForLetter = useShortcuts({ palette: togglePalette, help: () => setKeys(true) });

  useEffect(() => onWaking(setWaking), []);
  useEffect(() => {
    // Once the first page is up, fetch the others in the background.
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => preloadPages());
    else setTimeout(preloadPages, 1200);
  }, []);
  useEffect(() => {
    setDrawer(false);
    const here = nav.flatMap((g) => g.items).find((n) => isHere(n, location.pathname));
    document.title = here ? `${here.label} · Crux` : "Crux";
    // A new page starts at its top, wherever the last one was scrolled to.
    window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, role]);
  useEffect(() => {
    if (!drawer) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [drawer]);

  const brain = brainOf(health.data?.models.investigator);
  const waitingCount = session.cases.filter((c) => modelOf(c)?.status === "waiting").length;
  const hazards = openHazards(session);

  return (
    <div className="app">
      {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}
      <aside className={cx("side", drawer && "open")}>
        <Link to="/" viewTransition className="brand" aria-label="Crux, home">
          <Mark />
          Crux
        </Link>

        <div className="side-context">
          <div className="site">
            <Building2 size={14} aria-hidden />
            <span className="truncate">{SITE.name}</span>
            <Hint label="About this plant">{SITE.note}</Hint>
          </div>
          <div className="views" role="group" aria-labelledby="views-label">
            <div className="views-label">
              <span id="views-label">Viewing as</span>
              <Hint label="About views">A view, not a login. It sets the first page and the menu order, and hides nothing.</Hint>
            </div>
            <div className="views-tabs">
              {ROLES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={cx(role === r.id && "on")}
                  aria-pressed={role === r.id}
                  title={r.who}
                  onClick={() => {
                    if (role === r.id) return;
                    setRole(r.id);
                    navigate("/", { viewTransition: true });
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <nav className="nav" aria-label="Main">
          {nav.map((g, gi) => (
            <div className="nav-group" key={g.group || gi}>
              {g.group && <span>{g.group}</span>}
              {g.items.map((n) => {
                const on = isHere(n, location.pathname);
                return (
                  <Link key={n.to} to={n.to} viewTransition className={cx(on && "on")} aria-current={on ? "page" : undefined}>
                    <n.icon size={16} aria-hidden />
                    <span className="grow truncate">{n.label}</span>
                    {n.to === "/cases" && session.cases.length > 0 && (
                      <span className={cx("nav-count", waitingCount > 0 && "warn")} title={waitingCount > 0 ? `${waitingCount} waiting for a measurement` : `${session.cases.length} in this browser`}>
                        <CountUp value={waitingCount > 0 ? waitingCount : session.cases.length} ms={300} />
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="side-foot">
          <Link to="/system" viewTransition className="ai-note" title="Which model runs each AI job">
            <span className={cx("ai-dot", brain.live && "live")} aria-hidden />
            <span className="truncate">
              Crux's AI · <b>{health.data ? brain.name : health.error ? "engine unreachable" : "…"}</b>
            </span>
          </Link>
          <button type="button" className="kbd keys-btn" onClick={() => setKeys(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
            ?
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="top">
          <Button className="menu-btn" variant="ghost" icon={<Menu size={18} />} onClick={() => setDrawer(true)} aria-label="Open the menu" />
          <button type="button" className="search" onClick={() => setPalette(true)} aria-label="Search and commands">
            <Search size={15} aria-hidden />
            <span className="search-text">Search or jump to…</span>
            <span className="kbd">{MOD_KEY}K</span>
          </button>
          <div className="top-end">
            <LivePill />
            <Button variant="ghost" className="tour-btn" icon={<Compass size={16} />} onClick={beginTour} aria-label="Take the tour">
              <span className="long">Tour</span>
            </Button>
            <Button variant="ghost" icon={theme === "dark" ? <Sun size={16} /> : <Moon size={16} />} onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"} />
            <Button variant="primary" className="top-primary" icon={<Plus size={15} />} onClick={() => openLauncher()}>
              <span className="long">Investigate a machine</span>
              <span className="short">Investigate</span>
            </Button>
          </div>
          {(waking || navigation.state === "loading") && <div className={cx("progress top-progress", !waking && "later")} aria-hidden />}
        </header>
        {waking && (
          <div className="waking" role="status">
            Waking the engine: a few seconds.
          </div>
        )}
        {hazards.length > 0 && (
          <div className="banners">
            {hazards.map((h) => (
              <HazardBanner key={h.id} id={h.id} text={h.text} machine={machineOfCase(session.cases.find((c) => c.id === h.id)).short} />
            ))}
          </div>
        )}
        <main className="content">
          <Suspense fallback={null}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <Launcher />
      <Tour />
      <Toasts />
      <CommandPalette open={palette} onClose={closePalette} onTheme={toggleTheme} onKeys={() => setKeys(true)} theme={theme} />
      <ShortcutsDialog open={keys} onClose={closeKeys} />
      {waitingForLetter && <GoHint />}
    </div>
  );
}

/** A hazard someone reported stays on top of every page until a person puts their name to it. */
function HazardBanner({ id, text, machine }: { id: string; text: string; machine: string }) {
  const [by, setBy] = useState("");
  const acknowledge = (e: FormEvent) => {
    e.preventDefault();
    const name = by.trim();
    if (!name) return;
    patchCase(id, { hazardAck: { by: name, at: Date.now() } });
    toast(`Hazard on ${machine} acknowledged by ${name}`, "warn");
  };
  return (
    <div className="banner" role="alert">
      <ShieldAlert size={16} aria-hidden />
      <p className="banner-text" title={text}>
        <b>Hazard on {machine}.</b> {text}
      </p>
      <form className="banner-actions" onSubmit={acknowledge}>
        <Link to={`/cases/${id}`} viewTransition className="btn btn-sm">
          Open investigation
        </Link>
        <input className="input input-sm" placeholder="Your name" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Your name, to acknowledge the hazard" />
        <Button size="sm" variant="danger" type="submit" disabled={!by.trim()}>
          Acknowledge hazard
        </Button>
      </form>
    </div>
  );
}
