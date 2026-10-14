// Hash routes: the server serves the app only at "/", so "/#/cases/abc"
// survives a refresh and a QR scan with no server change.

import type { ComponentType } from "react";
import { Navigate, createHashRouter, useParams, type RouteObject } from "react-router";
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

/** A machine has one page; the console's old address for it lands there. */
function ToMachine() {
  const { id = "" } = useParams();
  return <Navigate to={`/m/${encodeURIComponent(id)}`} replace />;
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
          // The first page: what Crux does, and every machine.
          { index: true, lazy: async () => ({ Component: (await import("../simple/Home")).default }), hydrateFallbackElement: <Blank /> },
          page("m/:id", () => import("../simple/Machine").then((m) => m.default)),
          page("how", () => import("../simple/How").then((m) => m.default)),
          // The old address of the console's home still lands somewhere sensible.
          { path: "console", element: <Navigate to="/plant" replace /> },
          page("plant", PAGES.plant),
          page("crew", PAGES.crew),
          page("manager", PAGES.manager),
          { path: "machines/:id", element: <ToMachine /> },
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
          page("anatomy", PAGES.anatomy),
          page("trends", PAGES.trends),
          page("go/:what", PAGES.go),
          page("*", PAGES.notFound),
        ],
      },
    ],
  },
  { ...page("phone/check/:id", PAGES.phoneCheck), errorElement: <PageError phone /> },
]);
