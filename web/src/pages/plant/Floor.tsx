// The plant floor: every machine as a tile, grouped by area or by whose turn it
// is, under a strip that counts where they stand and filters them. Tiles glide
// when they move between groups, so a hand-off from one person to the next is
// seen as it happens.

import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { useFlip } from "../../lib/glide";
import { AREAS, STANDING, standingOf, type Standing } from "../../lib/plant";
import type { Shift } from "../../lib/shift";
import type { PlantRow } from "../../lib/useplant";
import { Button, CountUp, cx } from "../../ui/kit";
import { MachineTile } from "./Tile";

export type Show = "all" | Standing;
export type View = "area" | "turn";

const ORDER: Standing[] = ["person", "crux", "ok", "idle"];
export const SHOWS: Show[] = ["all", ...ORDER];

export function Strip({ rows, show, onShow }: { rows: PlantRow[]; show: Show; onShow: (s: Show) => void }) {
  const count = (s: Show) => (s === "all" ? rows.length : rows.filter((r) => standingOf(r.st) === s).length);
  return (
    <div className="standing" data-tour="plant-strip">
      <div className="standing-chips" role="group" aria-label="Show machines">
        {SHOWS.map((s) => (
          <button key={s} type="button" className={cx("standing-chip", `is-${s}`, show === s && "on")} aria-pressed={show === s} onClick={() => onShow(s)}>
            {s !== "all" && <span className="standing-dot" aria-hidden />}
            {s === "all" ? "All" : STANDING[s].label}
            <b className="num">
              <CountUp value={count(s)} ms={420} />
            </b>
          </button>
        ))}
      </div>
      <div className="standing-bar" aria-hidden>
        {ORDER.map((s) => (
          <span key={s} className={`is-${s}`} style={{ flexGrow: count(s) }} />
        ))}
      </div>
    </div>
  );
}

type Group = { id: string; title: string; hint?: string; link?: { to: string; label: string }; rows: PlantRow[]; keep?: boolean };

function groupsOf(rows: PlantRow[], view: View, all: boolean): Group[] {
  if (view === "area") return AREAS.map((a) => ({ id: a.id, title: a.name, hint: a.line, rows: rows.filter((r) => r.m.area === a.id) })).filter((g) => g.rows.length > 0);
  const lane = (r: PlantRow) => {
    const s = standingOf(r.st);
    return s === "crux" ? "crux" : s === "person" ? (r.st.owner ?? "none") : "none";
  };
  const lanes: Group[] = [
    { id: "crux", title: "Crux", rows: [], keep: true },
    { id: "control", title: "Control room", rows: [] },
    { id: "crew", title: "Maintenance", link: { to: "/crew", label: "My work" }, rows: [], keep: true },
    { id: "manager", title: "Manager", link: { to: "/manager", label: "Summary" }, rows: [], keep: true },
    { id: "none", title: "No one's turn", rows: [] },
  ];
  for (const g of lanes) g.rows = rows.filter((r) => lane(r) === g.id).sort((a, b) => b.st.rank - a.st.rank || a.m.name.localeCompare(b.m.name));
  // The people's lanes stay in view even when empty, so a hand-off has somewhere to go.
  return lanes.filter((g) => g.rows.length > 0 || (all && g.keep));
}

export function Floor({ rows, show, view, shift, stage, onShowAll }: { rows: PlantRow[]; show: Show; view: View; shift: Shift | null; stage?: string; onShowAll: () => void }) {
  const ref = useFlip<HTMLDivElement>();
  const shown = show === "all" ? rows : rows.filter((r) => standingOf(r.st) === show);
  const itemOf = (id: string) => shift?.items.find((i) => i.machine === id);

  // One flat list, so a tile keeps its place in the page while it changes group and can glide there.
  const items: ReactNode[] = [];
  for (const g of groupsOf(shown, view, show === "all")) {
    items.push(
      <div key={`h:${view}:${g.id}`} className={cx("floor-head", `lane-${g.id}`)} data-flip={`h:${view}:${g.id}`}>
        <h2 title={g.hint}>{g.title}</h2>
        <span className="floor-count num">{g.rows.length}</span>
        {g.link && (
          <Link to={g.link.to} className="floor-link">
            {g.link.label}
            <ArrowRight size={12} aria-hidden />
          </Link>
        )}
      </div>,
    );
    if (g.rows.length === 0) items.push(<div key={`e:${g.id}`} className="floor-empty" data-flip={`e:${g.id}`}>Nothing waiting</div>);
    for (const r of g.rows) items.push(<MachineTile key={r.m.id} m={r.m} st={r.st} item={itemOf(r.m.id)} onStage={stage === r.m.id} />);
  }

  return (
    <div className={cx("floor", `view-${view}`)} ref={ref} data-tour="plant-floor">
      {items}
      {shown.length === 0 && (
        <div className="floor-none">
          <b>No machines here right now.</b>
          <Button size="sm" onClick={onShowAll}>
            Show all machines
          </Button>
        </div>
      )}
    </div>
  );
}
