import { Activity, Bot, ClipboardList, Factory, FolderOpen, LayoutDashboard, Network, ScanLine, ShieldCheck, type LucideIcon } from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Operate",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
      { to: "/cases", label: "Cases", icon: FolderOpen },
      { to: "/work-orders", label: "Work orders", icon: ClipboardList },
    ],
  },
  {
    group: "Intelligence",
    items: [
      { to: "/agents", label: "Agents", icon: Bot },
      { to: "/proof", label: "Proof", icon: ShieldCheck },
    ],
  },
  {
    group: "Plant",
    items: [
      { to: "/machines", label: "Machines", icon: Factory },
      { to: "/lens", label: "Lens scans", icon: ScanLine },
      { to: "/network", label: "Network", icon: Network },
    ],
  },
  {
    group: "Platform",
    items: [{ to: "/system", label: "System", icon: Activity }],
  },
];
