// Every page, loaded on demand. The router waits for a page's code before it
// moves, so a move between pages can animate into the page as it will look.

import type { ComponentType } from "react";

type Load = () => Promise<ComponentType>;

export const PAGES = {
  plant: () => import("../pages/Plant").then((m) => m.default),
  crew: () => import("../pages/Crew").then((m) => m.default),
  manager: () => import("../pages/Manager").then((m) => m.default),
  plantMachine: () => import("../pages/PlantMachine").then((m) => m.default),
  cases: () => import("../pages/Cases").then((m) => m.default),
  casePage: () => import("../pages/CasePage").then((m) => m.default),
  agents: () => import("../pages/Agents").then((m) => m.default),
  proof: () => import("../pages/Proof").then((m) => m.default),
  machinePage: () => import("../pages/MachinePage").then((m) => m.default),
  workOrders: () => import("../pages/WorkOrders").then((m) => m.WorkOrders),
  workOrder: () => import("../pages/WorkOrders").then((m) => m.WorkOrderPage),
  lens: () => import("../pages/Lens").then((m) => m.Lens),
  lensScan: () => import("../pages/Lens").then((m) => m.LensScan),
  network: () => import("../pages/Network").then((m) => m.default),
  system: () => import("../pages/System").then((m) => m.default),
  phoneCheck: () => import("../pages/PhoneCheck").then((m) => m.default),
  notFound: () => import("../pages/NotFound").then((m) => m.default),
  go: () => import("../pages/Go").then((m) => m.default),
  trends: () => import("../pages/trends/TrendsPage").then((m) => m.default),
} satisfies Record<string, Load>;

/**
 * Fetch every page in the background, so moving to one never waits on the
 * network. Done in the deployed build only: in development a page fetched
 * early would bring its compile errors onto whatever page is open.
 */
export function preloadPages() {
  if (!import.meta.env.PROD) return;
  for (const load of Object.values(PAGES) as Load[]) void load().catch(() => undefined);
}
