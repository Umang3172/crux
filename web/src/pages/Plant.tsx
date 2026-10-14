// The control room: every machine, where it stands and whose turn it is. The
// floor fills the page; who is needed, what Crux did and the guided runs are
// a tab away each (?tab=needs|activity|guided).

import { useState } from "react";
import { useSearchParams } from "react-router";
import { Sunrise } from "lucide-react";
import { SITE, standingOf } from "../lib/plant";
import { startShift } from "../lib/shift";
import { usePlant } from "../lib/useplant";
import { Button, Hint, PageHead, Seg, Tabs } from "../ui/kit";
import { ActivityFeed } from "./live";
import { Floor, SHOWS, Strip, type Show, type View } from "./plant/Floor";
import { Attention, Guided } from "./plant/Rail";
import { ShiftBand, stageOf } from "./plant/ShiftBand";
import "../styles/plant.css";
import "../styles/viz.css";
import "./pages.css";

export { Flow } from "./plant/Flow";
export { Attention };

type Tab = "floor" | "needs" | "activity" | "guided";
const TABS: Tab[] = ["floor", "needs", "activity", "guided"];

export default function Plant() {
  const { rows, shift, session } = usePlant();
  const [params, setParams] = useSearchParams();
  const asked = params.get("show") as Show | null;
  const show: Show = asked && SHOWS.includes(asked) ? asked : "all";
  const view: View = params.get("view") === "turn" ? "turn" : "area";
  const askedTab = params.get("tab") as Tab | null;
  const tab: Tab = askedTab && TABS.includes(askedTab) ? askedTab : "floor";
  const needed = rows.filter((r) => standingOf(r.st) === "person").length;
  const [pick, setPick] = useState<string | null>(null);
  const stage = stageOf(shift, pick);
  const first = !shift && session.cases.length === 0;

  // The filter and the grouping live in the address, so a view can be shared or linked to.
  const choose = (key: string, value: string, plain: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value === plain) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  return (
    <div className="page plant-page">
      <PageHead
        eyebrow={SITE.name}
        title="Control room"
        sub="Every machine, and whose turn it is."
        actions={
          !first && (
            <Button icon={<Sunrise size={15} />} onClick={() => void startShift()} disabled={shift?.running} data-tour="plant-start">
              {shift ? "Start next shift" : "Start a shift"}
            </Button>
          )
        }
      />

      <ShiftBand first={first} shift={shift} rows={rows} stage={stage} onStage={setPick} />

      <div className="col plant-main">
        <Tabs
          value={tab}
          onChange={(t) => choose("tab", t, "floor")}
          label="Control room"
          tabs={[
            { id: "floor", label: "Floor" },
            { id: "needs", label: "Needs someone", count: needed || undefined },
            { id: "activity", label: "Crux at work" },
            { id: "guided", label: "Guided runs" },
          ]}
        />

        {tab === "floor" && (
          <>
            <div className="floor-bar">
              <Strip rows={rows} show={show} onShow={(s) => choose("show", s, "all")} />
              <Seg
                value={view}
                onChange={(v) => choose("view", v, "area")}
                label="Group machines"
                options={[
                  { id: "area", label: "By area" },
                  { id: "turn", label: "By turn", title: "Group by whose turn it is" },
                ]}
              />
            </div>
            <Floor rows={rows} show={show} view={view} shift={shift} stage={stage} onShowAll={() => choose("show", "all", "all")} />
            <p className="floor-note">
              {SITE.note}{" "}
              <Hint label="About this plant">
                The four modelled machines share the engine's one machine model and differ in speed only. The watched life comes from the server's own list; machines with no sensor have nothing fitted.
              </Hint>
            </p>
          </>
        )}
        {tab === "needs" && <Attention rows={rows} />}
        {tab === "activity" && <ActivityFeed />}
        {tab === "guided" && <Guided />}
      </div>
    </div>
  );
}
