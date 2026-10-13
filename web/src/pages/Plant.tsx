// The plant: every machine, where it stands and whose turn it is. The control
// room's first page.

import { useState } from "react";
import { useSearchParams } from "react-router";
import { Sunrise } from "lucide-react";
import { SITE } from "../lib/plant";
import { startShift } from "../lib/shift";
import { usePlant } from "../lib/useplant";
import { Button, Hint, PageHead, Seg } from "../ui/kit";
import { ActivityFeed } from "./live";
import { Floor, SHOWS, Strip, type Show, type View } from "./plant/Floor";
import { Attention, Guided } from "./plant/Rail";
import { ShiftBand, stageOf } from "./plant/ShiftBand";
import "../styles/plant.css";
import "../styles/viz.css";
import "./pages.css";

export { Flow } from "./plant/Flow";
export { Attention };

export default function Plant() {
  const { rows, shift, session } = usePlant();
  const [params, setParams] = useSearchParams();
  const asked = params.get("show") as Show | null;
  const show: Show = asked && SHOWS.includes(asked) ? asked : "all";
  const view: View = params.get("view") === "turn" ? "turn" : "area";
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
        title="Plant"
        sub="Every machine, where it stands and whose turn it is."
        actions={
          !first && (
            <Button icon={<Sunrise size={15} />} onClick={() => void startShift()} disabled={shift?.running} data-tour="plant-start">
              {shift ? "Start next shift" : "Start a shift"}
            </Button>
          )
        }
      />

      <ShiftBand first={first} shift={shift} rows={rows} stage={stage} onStage={setPick} />

      <div className="plant-split">
        <div className="col plant-main">
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
        </div>

        <aside className="col rail plant-rail">
          <Attention rows={rows} />
          <Guided />
          <ActivityFeed />
        </aside>
      </div>
    </div>
  );
}
