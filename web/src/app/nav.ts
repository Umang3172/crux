// The menu, in the words of the people who use the console. What comes first
// depends on who is looking; nothing is hidden from anyone.

import { Activity, BookOpen, ClipboardList, Factory, FolderOpen, HardHat, LayoutDashboard, ScanLine, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import type { Role } from "../lib/role";

export type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };
export type NavGroup = { group: string; items: NavItem[] };

const investigations: NavItem = { to: "/cases", label: "Investigations", icon: FolderOpen };
const orders: NavItem = { to: "/work-orders", label: "Work orders", icon: ClipboardList };
const scans: NavItem = { to: "/lens", label: "Phone scans", icon: ScanLine };
const lessons: NavItem = { to: "/network", label: "Lessons and updates", icon: BookOpen };
const record: NavItem = { to: "/proof", label: "Track record", icon: ShieldCheck };
const how: NavItem = { to: "/agents", label: "How Crux works", icon: Sparkles };
const system: NavItem = { to: "/system", label: "System", icon: Activity };
const plant = (home: boolean): NavItem => ({ to: home ? "/" : "/plant", label: "Plant", icon: Factory, end: home });

export function navFor(role: Role): NavGroup[] {
  if (role === "crew") {
    return [
      { group: "My job", items: [{ to: "/", label: "My work", icon: HardHat, end: true }, plant(false), orders, scans] },
      { group: "About", items: [how, record] },
    ];
  }
  if (role === "manager") {
    return [
      { group: "Decide", items: [{ to: "/", label: "Summary", icon: LayoutDashboard, end: true }, plant(false), investigations, orders] },
      { group: "Learn", items: [lessons, record] },
      { group: "About", items: [how, system] },
    ];
  }
  return [
    { group: "Monitor", items: [plant(true), investigations, orders] },
    { group: "On the floor", items: [scans] },
    { group: "Learn", items: [lessons, record] },
    { group: "About", items: [how, system] },
  ];
}
