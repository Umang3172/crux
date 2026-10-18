// The one frame every page sits in: a name, five sections, a search and the
// one action that starts an investigation. Inside a section, its pages are a
// row of tabs under the bar. A hazard someone reported stays on top of every
// page until a person puts their name to it.

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, Outlet, useLocation, useNavigation } from "react-router";
import { Compass, Menu, Moon, Plus, Search, ShieldAlert, Sun, X } from "lucide-react";
import { onWaking } from "../api/client";
import { brainOf } from "../lib/ai";
import { useHealth, useTheme, type Theme } from "../lib/hooks";
import { machineOfCase } from "../lib/plant";
import { openHazards, patchCase, useSession } from "../lib/session";
import { Button, Toasts, cx, toast } from "../ui/kit";
import { CommandPalette } from "./CommandPalette";
import { GoHint, MOD_KEY, ShortcutsDialog, useShortcuts } from "./keys";
import { Launcher, openLauncher } from "./Launcher";
import { Tour } from "../tour/Tour";
import { beginTour } from "../tour/steps";
import { LivePill } from "./LiveNow";
import { SECTIONS, isHere, pageOf, sectionOf } from "./nav";
import { preloadPages } from "./pages";
import "../styles/plant.css";
import "./shell.css";

export function Mark() {
  // The crux: two lines of evidence crossing at the one point that decides.
  return (
    <span className="mn-mark" aria-hidden>
      <svg width="12" height="12" viewBox="0 0 12 12">
        <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** Light or dark: the icon shows the theme a press turns to. */
function ThemeButton({ theme, onTurn }: { theme: Theme; onTurn: (at: { x: number; y: number }) => void }) {
  const to = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" className="mn-icon-btn mn-theme" onClick={(e) => onTurn({ x: e.clientX, y: e.clientY })} aria-label={`Switch to the ${to} theme`} title={`Switch to the ${to} theme`}>
      {to === "dark" ? <Moon size={16} aria-hidden /> : <Sun size={16} aria-hidden />}
    </button>
  );
}

export function Shell() {
  const health = useHealth();
  const [theme, turnTheme] = useTheme();
  const session = useSession();
  const { pathname } = useLocation();
  const navigation = useNavigation();
  const [palette, setPalette] = useState(false);
  const [keys, setKeys] = useState(false);
  const [menu, setMenu] = useState(false);
  const [waking, setWaking] = useState(false);
  const togglePalette = useCallback(() => setPalette((p) => !p), []);
  const closePalette = useCallback(() => setPalette(false), []);
  const closeKeys = useCallback(() => setKeys(false), []);
  const waitingForLetter = useShortcuts({ palette: togglePalette, help: () => setKeys(true) });

  const section = sectionOf(pathname);
  const here = pageOf(pathname);

  useEffect(() => onWaking(setWaking), []);
  useEffect(() => {
    // Once the first page is up, fetch the others in the background.
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => preloadPages());
    else setTimeout(preloadPages, 1200);
  }, []);
  useEffect(() => {
    setMenu(false);
    document.title = here && here.to !== "/" ? `${here.label} · Crux` : "Crux";
    // A new page starts at its top, wherever the last one was scrolled to.
    window.scrollTo(0, 0);
  }, [pathname, here]);
  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
  }, [menu]);

  const brain = brainOf(health.data?.models.investigator);
  const hazards = openHazards(session);
  const tabs = section && section.pages.length > 1 ? section.pages : null;

  return (
    <div className="app mn">
      <header className="mn-top">
        <div className="mn-wrap mn-top-in">
          <Link to="/" viewTransition className="mn-brand" aria-label="Crux, home">
            <Mark />
            Crux
          </Link>
          <nav className="mn-nav" aria-label="Main">
            {SECTIONS.map((s) => (
              <Link key={s.id} to={s.to} viewTransition aria-current={section?.id === s.id ? "page" : undefined}>
                {s.label}
              </Link>
            ))}
          </nav>
          <div className="mn-top-end">
            <LivePill />
            {/* A visitor with a minute starts here: the guided tour walks a shift on the real app. */}
            <button type="button" className="mn-btn sm ghost" onClick={beginTour} aria-label="Take the tour" title="Take the tour">
              <Compass size={15} aria-hidden />
              <span className="mn-hide-sm">Tour</span>
            </button>
            <button type="button" className="mn-icon-btn mn-search" onClick={() => setPalette(true)} aria-label="Search and commands" title={`Search (${MOD_KEY}K)`}>
              <Search size={16} aria-hidden />
            </button>
            <ThemeButton theme={theme} onTurn={turnTheme} />
            <button type="button" className="mn-btn sm" onClick={() => openLauncher()} data-tour="investigate">
              <Plus size={15} aria-hidden />
              <span className="mn-hide-sm">Investigate</span>
            </button>
            <button type="button" className="mn-icon-btn mn-menu-btn" onClick={() => setMenu(true)} aria-label="Open the menu" aria-expanded={menu}>
              <Menu size={18} aria-hidden />
            </button>
          </div>
        </div>
        {(waking || navigation.state === "loading") && <div className={cx("progress top-progress", !waking && "later")} aria-hidden />}
      </header>

      {waking && (
        <div className="waking" role="status">
          <div className="mn-wrap">Waking the engine: a few seconds.</div>
        </div>
      )}

      <div className="main">
        {hazards.length > 0 && (
          <div className="banners">
            {hazards.map((h) => (
              <HazardBanner key={h.id} id={h.id} text={h.text} machine={machineOfCase(session.cases.find((c) => c.id === h.id)).short} />
            ))}
          </div>
        )}

        {tabs && (
          <div className="mn-tabsrow">
            <nav className="mn-wrap mn-tabs" aria-label={section!.label}>
              {tabs.map((n) => {
                const on = isHere(n, pathname);
                return (
                  <Link key={n.to} to={n.to} viewTransition className={cx(on && "on")} aria-current={on ? "page" : undefined}>
                    {n.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        )}

        <main className="content">
          <Suspense fallback={null}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <footer className="mn-foot">
        <div className="mn-wrap">
          <span>A demo plant. Readings come from a physics model of each machine.</span>
          <span className="mn-foot-end">
            <span className={cx("ai-dot", brain.live && "live")} aria-hidden />
            {health.data ? (brain.live ? `AI: ${brain.name}` : "AI: offline stand-in") : health.error ? "Engine unreachable" : "Checking the engine…"}
            <button type="button" className="mn-link" onClick={() => setKeys(true)}>
              Shortcuts
            </button>
          </span>
        </div>
      </footer>

      {menu && <SheetMenu pathname={pathname} theme={theme} onTurn={turnTheme} onClose={() => setMenu(false)} />}

      <Launcher />
      <Tour />
      <Toasts />
      <CommandPalette open={palette} onClose={closePalette} onKeys={() => setKeys(true)} theme={theme} onTheme={turnTheme} />
      <ShortcutsDialog open={keys} onClose={closeKeys} />
      {waitingForLetter && <GoHint />}
    </div>
  );
}

/** On a phone, the sections and their pages fill the screen: one tap to anywhere. */
function SheetMenu({ pathname, theme, onTurn, onClose }: { pathname: string; theme: Theme; onTurn: (at: { x: number; y: number }) => void; onClose: () => void }) {
  return (
    <div className="mn-sheet" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="mn-sheet-head mn-wrap">
        <Link to="/" className="mn-brand" onClick={onClose}>
          <Mark />
          Crux
        </Link>
        <span className="row">
          <ThemeButton theme={theme} onTurn={onTurn} />
          <button type="button" className="mn-icon-btn" onClick={onClose} aria-label="Close the menu" autoFocus>
            <X size={18} aria-hidden />
          </button>
        </span>
      </div>
      <nav className="mn-sheet-body mn-wrap" aria-label="Main">
        {SECTIONS.map((s, i) => (
          <section key={s.id} style={{ animationDelay: `${i * 40}ms` }}>
            <Link to={s.to} className="mn-sheet-section" onClick={onClose}>
              {s.label}
            </Link>
            {s.pages.length > 1 && (
              <div className="mn-sheet-pages">
                {s.pages.map((n) => (
                  <Link key={n.to} to={n.to} onClick={onClose} aria-current={isHere(n, pathname) ? "page" : undefined}>
                    {n.label}
                  </Link>
                ))}
              </div>
            )}
          </section>
        ))}
      </nav>
    </div>
  );
}

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
      <div className="mn-wrap banner-in">
        <ShieldAlert size={16} aria-hidden />
        <p className="banner-text" title={text}>
          <b>Hazard on {machine}.</b> {text}
        </p>
        <form className="banner-actions" onSubmit={acknowledge}>
          <Link to={`/cases/${id}`} viewTransition className="btn btn-sm">
            Open
          </Link>
          <input className="input input-sm" placeholder="Your name" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Your name, to acknowledge the hazard" />
          <Button size="sm" variant="danger" type="submit" disabled={!by.trim()}>
            Acknowledge
          </Button>
        </form>
      </div>
    </div>
  );
}
