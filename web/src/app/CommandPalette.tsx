// Cmd-K: go anywhere, start an investigation, reopen one, switch the view.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Compass, CornerDownLeft, Eye, Factory, FolderOpen, HardHat, Keyboard, LayoutDashboard, Moon, Play, Plus, RotateCcw, Search, Sun, Sunrise } from "lucide-react";
import { modelOf } from "../lib/casemodel";
import { shortId } from "../lib/format";
import { launchScenario } from "../lib/launch";
import { machineOfCase } from "../lib/plant";
import { ROLES, setRole, useRole } from "../lib/role";
import { SCENARIOS } from "../lib/scenarios";
import { resetSession, useSession } from "../lib/session";
import { startShift } from "../lib/shift";
import type { Theme } from "../lib/hooks";
import { cx } from "../ui/kit";
import { finding } from "../pages/parts";
import { goKeys } from "./keys";
import { openLauncher } from "./Launcher";
import { navFor, plantPath } from "./nav";
import { beginTour } from "../tour/steps";

type Item = { id: string; group: string; label: string; hint?: ReactNode; icon: ReactNode; run: () => void | Promise<void> };

const keysHint = (keys: string) => (
  <>
    {keys.split(" ").map((k) => (
      <span key={k} className="kbd">
        {k}
      </span>
    ))}
  </>
);

export function CommandPalette({ open, onClose, onTheme, onKeys, theme }: { open: boolean; onClose: () => void; onTheme: () => void; onKeys?: () => void; theme?: Theme }) {
  const navigate = useNavigate();
  const session = useSession();
  const role = useRole();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => navigate(to, { viewTransition: true });
    const keyFor = (to: string) => goKeys(role).find((g) => g.to === to);
    // The three homes first, then every other page in any view's menu: nothing is hidden from anyone.
    const homes: Item[] = [
      { id: "home-control", group: "Go to", label: "Plant", hint: keysHint("g p"), icon: <Factory size={15} />, run: go(plantPath(role)) },
      { id: "home-crew", group: "Go to", label: "My work", hint: role === "crew" ? keysHint("g m") : "Maintenance", icon: <HardHat size={15} />, run: go(role === "crew" ? "/console" : "/crew") },
      { id: "home-manager", group: "Go to", label: "Summary", hint: role === "manager" ? keysHint("g m") : "Manager", icon: <LayoutDashboard size={15} />, run: go(role === "manager" ? "/console" : "/manager") },
    ];
    const pages = new Map<string, Item>();
    for (const n of [role, ...ROLES.map((r) => r.id)].flatMap((r) => navFor(r).flatMap((g) => g.items))) {
      if (n.to === "/console" || n.to === "/plant" || pages.has(n.to)) continue;
      const k = keyFor(n.to);
      pages.set(n.to, { id: `n-${n.to}`, group: "Go to", label: n.label, hint: k ? keysHint(`g ${k.key}`) : undefined, icon: <n.icon size={15} />, run: go(n.to) });
    }

    const recent: Item[] = [...session.cases]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 6)
      .map((c) => {
        const m = modelOf(c);
        return {
          id: `c-${c.id}`,
          group: "Recent investigations",
          label: `${machineOfCase(c).short} · ${m ? finding(m) : c.failed ? "did not finish" : "investigating"}`,
          hint: <span className="mono">{shortId(c.id)}</span>,
          icon: <FolderOpen size={15} />,
          run: go(`/cases/${c.id}`),
        };
      });

    const all: Item[] = [
      { id: "new", group: "Start", label: "Investigate a machine", icon: <Plus size={15} />, run: () => openLauncher() },
      {
        id: "shift",
        group: "Start",
        label: "Simulate a shift",
        icon: <Sunrise size={15} />,
        run: () => {
          navigate("/plant", { viewTransition: true });
          void startShift();
        },
      },
      ...SCENARIOS.map((s) => ({
        id: `s-${s.id}`,
        group: "Guided",
        label: s.title,
        icon: <Play size={15} />,
        run: async () => navigate(`/cases/${await launchScenario(s)}`, { viewTransition: true }),
      })),
      ...homes,
      ...pages.values(),
      ...recent,
      ...ROLES.map((r) => ({
        id: `v-${r.id}`,
        group: "View as",
        label: r.label,
        hint: r.id === role ? "current" : undefined,
        icon: <Eye size={15} />,
        run: () => {
          setRole(r.id);
          navigate("/console", { viewTransition: true });
        },
      })),
      { id: "tour", group: "Console", label: "Take the tour", icon: <Compass size={15} />, run: beginTour },
      { id: "theme", group: "Console", label: theme === "light" ? "Dark theme" : "Light theme", icon: theme === "light" ? <Moon size={15} /> : <Sun size={15} />, run: onTheme },
      ...(onKeys ? [{ id: "keys", group: "Console", label: "Keyboard shortcuts", hint: keysHint("?"), icon: <Keyboard size={15} />, run: onKeys }] : []),
      {
        id: "reset",
        group: "Console",
        label: "Reset session",
        icon: <RotateCcw size={15} />,
        run: () => {
          if (window.confirm("Start a fresh session? This browser forgets its investigations.")) {
            resetSession();
            navigate("/console");
          }
        },
      },
    ];
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((i) => `${i.label} ${typeof i.hint === "string" ? i.hint : ""} ${i.group}`.toLowerCase().includes(needle)) : all;
  }, [q, session.cases, navigate, onTheme, onKeys, theme, role]);

  useEffect(() => {
    if (open) {
      setQ("");
      setAt(0);
      window.setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => setAt(0), [q]);

  useEffect(() => {
    list.current?.querySelector(".palette-item.on")?.scrollIntoView({ block: "nearest" });
  }, [at]);

  if (!open) return null;

  function run(i: Item | undefined) {
    if (!i) return;
    onClose();
    void i.run();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAt((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAt((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(items[at]);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  let lastGroup = "";
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search and commands" onKeyDown={onKey}>
        <div className="palette-input">
          <Search size={16} className="dim" aria-hidden />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or jump to…" aria-label="Search" />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-list" ref={list}>
          {items.length === 0 && <div className="empty">No match for “{q}”.</div>}
          {items.map((i, k) => {
            const head = i.group !== lastGroup ? i.group : null;
            lastGroup = i.group;
            return (
              <div key={i.id}>
                {head && <div className="palette-group">{head}</div>}
                <button type="button" className={cx("palette-item", k === at && "on")} onMouseEnter={() => setAt(k)} onClick={() => run(i)}>
                  {i.icon}
                  <span className="truncate">{i.label}</span>
                  {i.hint && <span className="palette-hint">{i.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span className="row gap-1">
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> move
          </span>
          <span className="row gap-1">
            <span className="kbd">
              <CornerDownLeft size={10} />
            </span>{" "}
            open
          </span>
        </div>
      </div>
    </div>
  );
}
