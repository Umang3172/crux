// The menu: five sections across the top, and inside a section the pages it
// holds as a row of tabs. The words are a visitor's, not the engine's.

import { BookOpen, ChartLine, ClipboardList, Cpu, Factory, FolderOpen, HardHat, LayoutGrid, ListChecks, Box, ScanLine, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Other paths that show the same page, so the item reads as current there too. */
  also?: string[];
  /** The "go to" keys for it, as typed: "g p". */
  keys?: string;
};

export type Section = { id: string; label: string; to: string; pages: NavItem[] };

export const SECTIONS: Section[] = [
  {
    id: "machines",
    label: "Machines",
    to: "/",
    pages: [
      { to: "/", label: "Overview", icon: LayoutGrid, end: true, also: ["/m", "/machines"], keys: "g m" },
      { to: "/plant", label: "Control room", icon: Factory, also: ["/lives"], keys: "g p" },
    ],
  },
  {
    id: "cases",
    label: "Investigations",
    to: "/cases",
    pages: [{ to: "/cases", label: "Investigations", icon: FolderOpen, keys: "g i" }],
  },
  {
    id: "work",
    label: "Work",
    to: "/crew",
    pages: [
      { to: "/crew", label: "To do", icon: HardHat },
      { to: "/manager", label: "Sign-offs", icon: ListChecks },
      { to: "/work-orders", label: "Work orders", icon: ClipboardList, keys: "g w" },
      { to: "/lens", label: "Phone scans", icon: ScanLine },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    to: "/trends",
    pages: [
      { to: "/trends", label: "Trends", icon: ChartLine, keys: "g t" },
      { to: "/proof", label: "Track record", icon: ShieldCheck },
      { to: "/network", label: "Lessons", icon: BookOpen },
    ],
  },
  {
    id: "how",
    label: "How it works",
    to: "/how",
    pages: [
      { to: "/how", label: "Overview", icon: Sparkles },
      { to: "/agents", label: "The AI at work", icon: Cpu },
      { to: "/anatomy", label: "Anatomy", icon: Box, keys: "g a" },
      { to: "/system", label: "System", icon: Cpu },
    ],
  },
];

/** Whether a menu item is the page at `path`. */
export function isHere(n: NavItem, path: string): boolean {
  const at = (to: string, end?: boolean) => (end || to === "/" ? path === to : path === to || path.startsWith(`${to}/`));
  return at(n.to, n.end) || (n.also ?? []).some((p) => at(p));
}

/** The section a path belongs to, if any. */
export function sectionOf(path: string): Section | undefined {
  return SECTIONS.find((s) => s.pages.some((n) => isHere(n, path)));
}

/** The page of the menu a path shows, if any. */
export function pageOf(path: string): NavItem | undefined {
  return SECTIONS.flatMap((s) => s.pages).find((n) => isHere(n, path));
}
