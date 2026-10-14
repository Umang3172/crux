// The menu, in the words of the people who use the console. What comes first
// depends on who is looking; nothing is hidden from anyone.

import { Activity, BookOpen, ChartLine, ClipboardList, Factory, FolderOpen, HardHat, LayoutDashboard, ScanLine, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import type { Role } from "../lib/role";

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
/** An empty `group` is the role's own work: listed first, with no heading. */
export type NavGroup = { group: string; items: NavItem[] };

const investigations: NavItem = { to: "/cases", label: "Investigations", icon: FolderOpen, keys: "g i" };
const orders: NavItem = { to: "/work-orders", label: "Work orders", icon: ClipboardList, keys: "g w" };
const scans: NavItem = { to: "/lens", label: "Phone scans", icon: ScanLine };
const lessons: NavItem = { to: "/network", label: "Lessons and updates", icon: BookOpen };
const record: NavItem = { to: "/proof", label: "Track record", icon: ShieldCheck };
const how: NavItem = { to: "/agents", label: "How Crux works", icon: Sparkles };
const system: NavItem = { to: "/system", label: "System", icon: Activity };
const trends: NavItem = { to: "/trends", label: "Trends", icon: ChartLine, keys: "g t" };
const plant = (home: boolean): NavItem =>
  home ? { to: "/", label: "Plant", icon: Factory, end: true, also: ["/plant"], keys: "g p" } : { to: "/plant", label: "Plant", icon: Factory, keys: "g p" };

export function navFor(role: Role): NavGroup[] {
  if (role === "crew") {
    return [
      { group: "", items: [{ to: "/", label: "My work", icon: HardHat, end: true, also: ["/crew"], keys: "g m" }, plant(false), orders, scans] },
      { group: "About", items: [how, record] },
    ];
  }
  if (role === "manager") {
    return [
      { group: "", items: [{ to: "/", label: "Summary", icon: LayoutDashboard, end: true, also: ["/manager"], keys: "g m" }, plant(false), investigations, orders] },
      { group: "Learn", items: [trends, lessons, record] },
      { group: "About", items: [how, system] },
    ];
  }
  return [
    { group: "", items: [plant(true), investigations, orders, scans] },
    { group: "Learn", items: [trends, lessons, record] },
    { group: "About", items: [how, system] },
  ];
}

/** Whether a menu item is the page at `path`. */
export function isHere(n: NavItem, path: string): boolean {
  const at = (to: string, end?: boolean) => (end || to === "/" ? path === to : path === to || path.startsWith(`${to}/`));
  return at(n.to, n.end) || (n.also ?? []).some((p) => at(p));
}

/** Where "g p" goes: the plant is the control room's home, and a page of its own for everyone else. */
export const plantPath = (role: Role) => (role === "control" ? "/" : "/plant");
