// Who is looking. The console has no accounts: a person approves by typing
// their name. The view is a choice kept in this browser, and it changes what
// the first page is and what the menu puts first. It hides nothing.

import { useSyncExternalStore } from "react";

export type Role = "control" | "crew" | "manager";

export const ROLES: { id: Role; label: string; who: string; home: string }[] = [
  { id: "control", label: "Control room", who: "The monitoring team: which machine needs someone, and what Crux is doing.", home: "Plant" },
  { id: "crew", label: "Maintenance", who: "Technicians: the measurements Crux needs, and the repairs to do and check.", home: "My work" },
  { id: "manager", label: "Manager", who: "Whoever signs off: the decisions waiting, and how the plant is doing.", home: "Summary" },
];

const KEY = "crux.role";

function load(): Role {
  try {
    const r = window.localStorage.getItem(KEY);
    if (r === "control" || r === "crew" || r === "manager") return r;
  } catch {
    /* fall through */
  }
  return "control";
}

let role: Role = typeof window === "undefined" ? "control" : load();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useRole = () => useSyncExternalStore(subscribe, () => role, () => role);

/** The view right now, for code outside a component. */
export const getRole = () => role;

export function setRole(next: Role) {
  role = next;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    /* the choice lasts for this page only */
  }
  listeners.forEach((l) => l());
}
