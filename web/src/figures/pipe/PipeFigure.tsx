// The pipework from the scanned clip, with what the vision model saw put back
// on it: the part whose box it drew turns red, rust it reported is drawn as
// rust, and a leak drips. Nothing here is decided by the drawing; it shows the
// findings the scan already kept after the second look.

import { useEffect, useMemo, useRef } from "react";
import type { Finding } from "../../api/types";
import { useInView, useReducedMotion } from "../../lib/hooks";
import { useLoop } from "../live";
import { Plate, Raw, type Key } from "../Plate";
import { buildPipes, H, W } from "./geometry";
import { DRIP_EVERY_S, G_UNITS, SWELL_S, partAt, partName, type PartId } from "./model";

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** The part a scan's findings point at, and which of them the drawing shows. */
export function faultOf(findings: Finding[]): { part: PartId | null; leak: Finding | null; rust: Finding | null } {
  const leak = findings.find((f) => f.item === "leak" || f.item === "crack") ?? null;
  const rust = findings.find((f) => f.item === "corrosion") ?? null;
  const pointed = leak ?? rust ?? findings[0] ?? null;
  return { part: pointed ? partAt(pointed.box) : null, leak, rust };
}

export function PipeFigure({ findings, fig = "Fig 1", compact = false }: { findings: Finding[]; fig?: string; compact?: boolean }) {
  const geo = useMemo(() => buildPipes(), []);
  const { part, leak, rust } = faultOf(findings);
  const reduced = useReducedMotion();
  const [stage, seen] = useInView<HTMLDivElement>();
  const live = useRef<SVGGElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const clock = useRef(0);

  const from = geo.dripFrom(part ?? "upperTee");
  const fall = Math.sqrt((2 * from[2]) / G_UNITS);

  const draw = (dt: number) => {
    const g = live.current;
    if (!g) return false;
    if (!leak) {
      g.innerHTML = "";
      return false;
    }
    clock.current += reduced ? 0 : dt;
    const t = clock.current % DRIP_EVERY_S;
    const landed = t - SWELL_S - fall;
    const ring = landed >= 0 ? 2 + 11 * (1 - Math.exp(-landed / 0.16)) : 0;
    const fade = landed >= 0 ? Math.exp(-landed / 0.22) : 0;
    let s = geo.puddle(from[0], from[1], ring, fade);
    if (reduced) s += geo.drop(from, 1.9);
    else if (t < SWELL_S) s += geo.drop(from, 0.5 + 1.5 * smooth(t / SWELL_S));
    else {
      const since = t - SWELL_S;
      const z = from[2] - 0.5 * G_UNITS * since * since;
      if (z > 0.5) s += geo.drop([from[0], from[1], z], 1.7);
      s += geo.drop(from, 0.5 * smooth(since / 0.3));
    }
    g.innerHTML = s;
    return !reduced;
  };

  const kick = useLoop(draw, seen);
  useEffect(() => {
    clock.current = 0;
    draw(0);
    kick();
    if (readout.current) {
      const main = leak ?? rust;
      readout.current.textContent = main
        ? `${main.item} · ${main.severity} · kept after a second look`
        : "nothing seen on the clip";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, part, leak, rust, reduced]);

  const keys: Key[] = [];
  if (part && part !== "wall") keys.push({ mark: "pit", label: <>where the model boxed the {leak?.item ?? rust?.item ?? "finding"}: {partName(part)}</> });
  if (rust) keys.push({ mark: "rust", label: "rust the model reported" });
  if (leak) keys.push({ mark: "water", label: "drops, drawn: the clip's drip rate was not measured" });

  return (
    <div ref={stage}>
      <Plate
        fig={fig}
        title="The pipework, drawn from the clip"
        hint={leak ? "drips while on screen" : "nothing to show"}
        readout={readout}
        keys={compact ? [] : keys}
        caption={
          compact ? undefined : (
            <>
              Drawn from the scanned clip&apos;s own pipework: an upright pipe, a horizontal run welded into it and a smaller pipe welded in from above. The part in
              red is the one whose box the vision model drew on the clip&apos;s middle frame, matched by where that part sits in the frame. Sizes are proportions
              from the clip, not a drawing; a drop falls at true gravity if this is a 1-inch line. What a camera sees never moves a diagnosis: a person checks it by
              eye.
            </>
          )
        }
        role="img"
        aria-label={`${geo.label}${part && part !== "wall" ? ` Drawn in red: ${partName(part)}.` : ""}`}
      >
        <svg className="iso-svg" viewBox={`0 0 ${W} ${H}`} aria-hidden>
          <Raw svg={geo.base} />
          <Raw svg={geo.pipes(part)} />
          {rust && <Raw svg={geo.rust()} />}
          <g ref={live} />
        </svg>
      </Plate>
    </div>
  );
}
