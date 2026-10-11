// Hash routes: the server serves the app only at "/", so a fresh load of
// "/case/abc" would 404 there. "/#/case/abc" survives a refresh and a QR scan
// with no server change.

import { lazy, Suspense } from "react";
import { createHashRouter, Outlet } from "react-router";
import { Shell } from "./Shell";
import { PhoneShell } from "./PhoneShell";

const Plant = lazy(() => import("../pages/Plant"));
const Machine = lazy(() => import("../pages/Machine"));
const Case = lazy(() => import("../pages/Case"));
const WorkOrder = lazy(() => import("../pages/WorkOrder"));
const WorkOrders = lazy(() => import("../pages/WorkOrders"));
const Try = lazy(() => import("../pages/Try"));
const Proof = lazy(() => import("../pages/Proof"));
const Network = lazy(() => import("../pages/Network"));
const Scans = lazy(() => import("../pages/Scans"));
const How = lazy(() => import("../pages/How"));
const NotFound = lazy(() => import("../pages/NotFound"));
const StoryLaunch = lazy(() => import("../pages/StoryLaunch"));
const PhoneCheck = lazy(() => import("../pages/phone/Check"));
const PhoneLens = lazy(() => import("../pages/phone/Lens"));
const PhoneFound = lazy(() => import("../pages/phone/Found"));

const page = (el: React.ReactNode) => <Suspense fallback={null}>{el}</Suspense>;

export const router = createHashRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: page(<Plant />) },
      { path: "machine/:id", element: page(<Machine />) },
      { path: "case/:id", element: page(<Case />) },
      { path: "work-order/:id", element: page(<WorkOrder />) },
      { path: "work-orders", element: page(<WorkOrders />) },
      { path: "try", element: page(<Try />) },
      { path: "proof", element: page(<Proof />) },
      { path: "network", element: page(<Network />) },
      { path: "scans", element: page(<Scans />) },
      { path: "scans/:id", element: page(<Scans />) },
      { path: "how", element: page(<How />) },
      { path: "story/:id", element: page(<StoryLaunch />) },
      { path: "*", element: page(<NotFound />) },
    ],
  },
  {
    path: "phone",
    element: (
      <PhoneShell>
        <Outlet />
      </PhoneShell>
    ),
    children: [
      { path: "check/:caseId", element: page(<PhoneCheck />) },
      { path: "lens", element: page(<PhoneLens />) },
      { path: "found/:workOrderId", element: page(<PhoneFound />) },
    ],
  },
]);
