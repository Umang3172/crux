// Hash routes: the server serves the app only at "/", so "/#/cases/abc"
// survives a refresh and a QR scan with no server change.

import { lazy, Suspense, type ReactNode } from "react";
import { createHashRouter } from "react-router";
import { Shell } from "./Shell";

const Overview = lazy(() => import("../pages/Overview"));
const Cases = lazy(() => import("../pages/Cases"));
const CasePage = lazy(() => import("../pages/CasePage"));
const Agents = lazy(() => import("../pages/Agents"));
const Proof = lazy(() => import("../pages/Proof"));
const Machines = lazy(() => import("../pages/Machines"));
const MachinePage = lazy(() => import("../pages/MachinePage"));
const WorkOrders = lazy(() => import("../pages/WorkOrders").then((m) => ({ default: m.WorkOrders })));
const WorkOrderPage = lazy(() => import("../pages/WorkOrders").then((m) => ({ default: m.WorkOrderPage })));
const Lens = lazy(() => import("../pages/Lens").then((m) => ({ default: m.Lens })));
const LensScan = lazy(() => import("../pages/Lens").then((m) => ({ default: m.LensScan })));
const Network = lazy(() => import("../pages/Network"));
const System = lazy(() => import("../pages/System"));
const PhoneCheck = lazy(() => import("../pages/PhoneCheck"));
const NotFound = lazy(() => import("../pages/NotFound"));

const page = (el: ReactNode) => <Suspense fallback={null}>{el}</Suspense>;

export const router = createHashRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: page(<Overview />) },
      { path: "cases", element: page(<Cases />) },
      { path: "cases/:id", element: page(<CasePage />) },
      { path: "agents", element: page(<Agents />) },
      { path: "proof", element: page(<Proof />) },
      { path: "machines", element: page(<Machines />) },
      { path: "machines/*", element: page(<MachinePage />) },
      { path: "work-orders", element: page(<WorkOrders />) },
      { path: "work-orders/:id", element: page(<WorkOrderPage />) },
      { path: "lens", element: page(<Lens />) },
      { path: "lens/:id", element: page(<LensScan />) },
      { path: "network", element: page(<Network />) },
      { path: "system", element: page(<System />) },
      { path: "*", element: page(<NotFound />) },
    ],
  },
  { path: "phone/check/:id", element: page(<PhoneCheck />) },
]);
