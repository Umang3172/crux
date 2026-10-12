// Cmd-K: go anywhere, start a scenario, reopen a case.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { CornerDownLeft, FolderOpen, Moon, Play, Plus, RotateCcw, Search, Zap } from "lucide-react";
import { useRole } from "../lib/role";
import { startShift } from "../lib/shift";
import { modelOf } from "../lib/casemodel";
import { shortId } from "../lib/format";
import { launchScenario } from "../lib/launch";
import { fault } from "../lib/plain";
import { machineOfCase } from "../lib/plant";
import { SCENARIOS } from "../lib/scenarios";
import { resetSession, useSession } from "../lib/session";
import { cx } from "../ui/kit";
import { openLauncher } from "./Launcher";
import { navFor } from "./nav";

type Item = { id: string; group: string; label: string; hint?: string; icon: ReactNode; run: () => void | Promise<void> };

export function CommandPalette({ open, onClose, onTheme }: { open: boolean; onClose: () => void; onTheme: () => void }) {
  const navigate = useNavigate();
  const session = useSession();
  const role = useRole();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => navigate(to);
    const all: Item[] = [
      { id: "new", group: "Run", label: "Investigate a machine…", icon: <Plus size={15} />, run: () => openLauncher() },
      {
        id: "shift",
        group: "Run",
        label: "Simulate a shift: a reading from every modelled machine",
        icon: <Zap size={15} />,
        run: () => {
          navigate("/plant");
          void startShift();
        },
      },
      ...SCENARIOS.map((s) => ({
        id: `s-${s.id}`,
        group: "Run",
        label: `Guided: ${s.title}`,
        hint: s.shows,
        icon: <Play size={15} />,
        run: async () => navigate(`/cases/${await launchScenario(s)}`),
      })),
      ...navFor(role).flatMap((g) => g.items.map((n) => ({ id: `n-${n.to}`, group: "Go to", label: n.label, icon: <n.icon size={15} />, run: go(n.to) }))),
      ...[...session.cases]
        .reverse()
        .slice(0, 8)
        .map((c) => {
          const m = modelOf(c);
          return {
            id: `c-${c.id}`,
            group: "Recent investigations",
            label: `${machineOfCase(c).short} · ${shortId(c.id)}${m?.leader && m.status === "concluded" ? ` · ${fault(m.leader.kind).name}` : ""}`,
            hint: c.kind === "agents" ? "Crux's AI" : "engine",
            icon: <FolderOpen size={15} />,
            run: go(`/cases/${c.id}`),
          };
        }),
      { id: "theme", group: "Console", label: "Switch between dark and light", icon: <Moon size={15} />, run: onTheme },
      {
        id: "reset",
        group: "Console",
        label: "Reset this browser's session",
        icon: <RotateCcw size={15} />,
        run: () => {
          if (window.confirm("Start a fresh session? This browser forgets its investigations.")) {
            resetSession();
            navigate("/");
          }
        },
      },
    ];
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((i) => `${i.label} ${i.hint ?? ""} ${i.group}`.toLowerCase().includes(needle)) : all;
  }, [q, session.cases, navigate, onTheme, role]);

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
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKey}>
        <div className="palette-input">
          <Search size={16} className="dim" aria-hidden />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages, machines' investigations and guided runs…" aria-label="Search" />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-list" ref={list}>
          {items.length === 0 && <div className="empty">Nothing matches “{q}”.</div>}
          {items.map((i, k) => {
            const head = i.group !== lastGroup ? i.group : null;
            lastGroup = i.group;
            return (
              <div key={i.id}>
                {head && <div className="palette-group">{head}</div>}
                <button type="button" className={cx("palette-item", k === at && "on")} onMouseEnter={() => setAt(k)} onClick={() => run(i)}>
                  {i.icon}
                  <span className="truncate">{i.label}</span>
                  {i.hint && <small>{i.hint}</small>}
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
            run
          </span>
        </div>
      </div>
    </div>
  );
}
