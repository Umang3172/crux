// Hash routes: the server serves the app only at "/", so "/#/cases/abc"
// survives a refresh and a QR scan with no server change.

import type { ComponentType } from "react";
import { createHashRouter, type RouteObject } from "react-router";
import { useRole, type Role } from "../lib/role";
import { PageError } from "./PageError";
import { PAGES } from "./pages";
import { Shell } from "./Shell";

/** What fills the frame while the first page's code arrives: nothing, so the frame shows at once. */
const Blank = () => null;

const page = (path: string, load: () => Promise<ComponentType>): RouteObject => ({
  path,
  lazy: async () => ({ Component: await load() }),
  hydrateFallbackElement: <Blank />,
});

/** The first page is the one the person's job starts from. All three are loaded, so switching view is immediate. */
let homes: Record<Role, ComponentType> | null = null;
function Home() {
  const role = useRole();
  const Page = homes?.[role];
  return Page ? <Page /> : null;
}

export const router = createHashRouter([
  {
    element: <Shell />,
    errorElement: <PageError />,
    children: [
      {
        // A page that fails shows its error inside the frame, with the menu still there.
        errorElement: <PageError />,
        children: [
          {
            index: true,
            lazy: async () => {
              const [control, crew, manager] = await Promise.all([PAGES.plant(), PAGES.crew(), PAGES.manager()]);
              homes = { control, crew, manager };
              return { Component: Home };
            },
            hydrateFallbackElement: <Blank />,
          },
          page("plant", PAGES.plant),
          page("crew", PAGES.crew),
          page("manager", PAGES.manager),
          page("machines/:id", PAGES.plantMachine),
          page("lives/*", PAGES.machinePage),
          page("cases", PAGES.cases),
          page("cases/:id", PAGES.casePage),
          page("work-orders", PAGES.workOrders),
          page("work-orders/:id", PAGES.workOrder),
          page("lens", PAGES.lens),
          page("lens/:id", PAGES.lensScan),
          page("network", PAGES.network),
          page("proof", PAGES.proof),
          page("agents", PAGES.agents),
          page("system", PAGES.system),
          page("trends", PAGES.trends),
          page("go/:what", PAGES.go),
          page("*", PAGES.notFound),
        ],
      },
    ],
  },
  { ...page("phone/check/:id", PAGES.phoneCheck), errorElement: <PageError phone /> },
]);
