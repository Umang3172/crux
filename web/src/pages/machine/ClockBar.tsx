// The plant clock's controls: play, pause and scrub, and how much of the life
// the chart shows. Everything the chart and the tag show follows this clock.

import type { ReactNode } from "react";
import { num } from "../../lib/format";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import type { Zoom } from "./replay";
import type { PlantClock } from "./usePlantClock";
import s from "./ClockBar.module.css";

export function ClockBar({
  clock,
  min,
  max,
  zoom,
  onZoom,
  atEnd,
  extra,
}: {
  clock: PlantClock;
  min: number;
  max: number;
  zoom: Zoom;
  onZoom: (z: Zoom) => void;
  atEnd: boolean;
  /** Controls that sit beside the range switch, such as "Show what really happened". */
  extra?: ReactNode;
}) {
  const label = clock.playing ? "Pause" : atEnd ? "Replay" : "Play";
  return (
    <div className={s.bar}>
      <div className={s.clock}>
        <Button onClick={clock.playing ? clock.pause : clock.play} aria-label={`${label} the plant clock`} className={s.play}>
          <Icon name={clock.playing ? "pause" : atEnd ? "refresh" : "play"} size={16} />
          {label}
        </Button>
        <input
          className={s.slider}
          type="range"
          min={min}
          max={max}
          step={(max - min) / 1000}
          value={Math.min(Math.max(clock.now, min), max)}
          onChange={(e) => clock.seek(Number(e.target.value))}
          aria-label="Running hour of the recording"
          aria-valuetext={`Running hour ${num(clock.now, 2)}`}
        />
        <span className={s.readout}>
          Running hour <strong>{num(clock.now, 2)}</strong>
        </span>
      </div>
      <div className={s.row}>
        <div className={s.segment} role="group" aria-label="How much of the life to show">
          <button type="button" aria-pressed={zoom === "final"} onClick={() => onZoom("final")}>
            Final stretch
          </button>
          <button type="button" aria-pressed={zoom === "whole"} onClick={() => onZoom("whole")}>
            Whole recording
          </button>
        </div>
        {extra}
      </div>
    </div>
  );
}
