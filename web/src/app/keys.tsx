// The keyboard: Cmd/Ctrl-K for search, "g" then a letter to go somewhere, and
// "?" for the list. None of it fires while someone is typing in a field.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { X } from "lucide-react";
import { ROLES, useRole, type Role } from "../lib/role";
import { Button } from "../ui/kit";
import { plantPath } from "./nav";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
export const MOD_KEY = isMac ? "⌘" : "Ctrl";

/** True when the key press belongs to a field someone is typing in. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

type GoKey = { key: string; label: string; to: string };

export function goKeys(role: Role): GoKey[] {
  return [
    { key: "p", label: "Plant", to: plantPath(role) },
    { key: "i", label: "Investigations", to: "/cases" },
    { key: "w", label: "Work orders", to: "/work-orders" },
    { key: "a", label: "Anatomy", to: "/anatomy" },
    { key: "t", label: "Trends", to: "/trends" },
    { key: "m", label: role === "control" ? "Home" : (ROLES.find((r) => r.id === role)?.home ?? "Home"), to: "/" },
  ];
}

/** Listens for the console's keys. Returns true while a "g" waits for its letter. */
export function useShortcuts(on: { palette: () => void; help: () => void }): boolean {
  const navigate = useNavigate();
  const role = useRole();
  const [waiting, setWaiting] = useState(false);
  const handlers = useRef(on);
  handlers.current = on;

  useEffect(() => {
    let armed = false;
    let timer = 0;
    const disarm = () => {
      armed = false;
      window.clearTimeout(timer);
      setWaiting(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        handlers.current.palette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented || isTyping(e)) return;
      // An open dialog keeps its keys to itself.
      if (document.querySelector(".overlay")) return disarm();
      if (armed) {
        const hit = goKeys(role).find((g) => g.key === e.key.toLowerCase());
        disarm();
        if (hit) {
          e.preventDefault();
          navigate(hit.to, { viewTransition: true });
        }
        return;
      }
      if (e.key === "g") {
        armed = true;
        setWaiting(true);
        timer = window.setTimeout(disarm, 1500);
      } else if (e.key === "?") {
        e.preventDefault();
        handlers.current.help();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      disarm();
    };
  }, [role, navigate]);

  return waiting;
}

/** While a "g" waits for its letter: where each letter goes. */
export function GoHint() {
  const role = useRole();
  return (
    <div className="go-hint" role="status">
      <span className="kbd">g</span>
      {goKeys(role).map((g) => (
        <span key={g.key}>
          <span className="kbd">{g.key}</span> {g.label}
        </span>
      ))}
    </div>
  );
}

/** The "?" list. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const role = useRole();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("keydown", esc);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;

  const rows: { keys: string[]; label: string }[] = [
    { keys: [MOD_KEY, "K"], label: "Search and commands" },
    ...goKeys(role).map((g) => ({ keys: ["g", g.key], label: g.label })),
    { keys: ["?"], label: "This list" },
  ];
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="keys-panel" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabIndex={-1} ref={panel}>
        <header>
          <h2>Keyboard shortcuts</h2>
          <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={onClose} aria-label="Close" />
        </header>
        <ul>
          {rows.map((r) => (
            <li key={r.keys.join(" ")}>
              <span className="keys-combo">
                {r.keys.map((k, i) => (
                  <span key={i} className="kbd">
                    {k}
                  </span>
                ))}
              </span>
              {r.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
