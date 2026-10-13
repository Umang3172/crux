// One machine on the plant floor: its drawing, its name, one line on where it
// stands, the rail of its workflow, and an action only when a person has one.
// The whole tile opens the machine; its name grows into that page's title.

import { Link } from "react-router";
import { useShownProgress } from "../../lib/floorplay";
import { num } from "../../lib/format";
import { useChangeCount } from "../../lib/glide";
import { useMachineModel } from "../../lib/hooks";
import { MODE, machinePath, standingOf, type MachineStatus, type PlantMachine } from "../../lib/plant";
import type { ShiftItem } from "../../lib/shift";
import { MachineGlyph, type GlyphFrame } from "../../ui/MachineGlyph";
import { LinkButton, SourceTag, cx, vt } from "../../ui/kit";
import { LiveCall } from "../live";
import { Flow } from "./Flow";

export function MachineTile({ m, st, item, onStage }: { m: PlantMachine; st: MachineStatus; item?: ShiftItem; onStage?: boolean }) {
  const model = useMachineModel();
  const standing = standingOf(st);
  const byAgents = !!st.busy && item?.reading?.by === "agents";
  const progress = useShownProgress(byAgents ? item?.caseId : undefined);
  // While the calls are still arriving their number is not known, so the frame only says "under way".
  const frame: GlyphFrame = st.busy
    ? { value: progress && !progress.streaming && progress.total > 0 ? (progress.at + 1) / progress.total : null, tone: byAgents ? "model" : "accent" }
    : standing === "person"
      ? { value: 1, tone: st.tone === "danger" ? "danger" : "warn" }
      : standing === "ok"
        ? { value: 1, tone: "ok" }
        : { value: 0 };
  const changed = useChangeCount(`${st.label}|${standing}`);
  const rpm = m.mode === "model" ? (m.rpm ?? model.data?.nominal_rpm) : undefined;
  const facts = [m.type, rpm ? `${num(rpm, 0)} rpm` : null, MODE[m.mode].label].filter(Boolean).join(" · ");
  const synthetic = m.mode === "model" || !!m.synthetic;
  const act = standing === "person" ? st.next : undefined;

  return (
    <article className={cx("tile", `is-${standing}`, st.tone === "danger" && "is-danger", onStage && "on-stage")} data-flip={m.id} data-machine={m.id}>
      {changed > 0 && <span key={changed} className="tile-pulse" aria-hidden />}
      <div className="tile-main">
        <div className="tile-art" title={facts}>
          <MachineGlyph kind={m.kind} rpm={rpm} running={m.mode === "model" && st.tone !== "danger"} width={84} frame={frame} />
          {synthetic && <SourceTag source="synthetic" />}
        </div>
        <div className="tile-text">
          <Link to={machinePath(m)} viewTransition className="tile-name" style={vt(`m-${m.id}`)}>
            {m.name}
          </Link>
          <p className={cx("tile-status", `tone-${st.busy ? (byAgents ? "model" : "accent") : st.tone}`)} title={st.busy ? undefined : st.detail}>
            <span className="tile-dot" aria-hidden />
            <span className="tile-said">{st.busy ? byAgents ? item?.caseId ? <LiveCall caseId={item.caseId} /> : "starting…" : "Engine testing every suspect" : st.label}</span>
          </p>
        </div>
      </div>
      <Flow m={m} st={st} />
      {act && (
        <div className="tile-act">
          <LinkButton size="sm" to={act.to}>
            {act.label}
          </LinkButton>
        </div>
      )}
    </article>
  );
}
