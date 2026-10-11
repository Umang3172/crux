// The pump on the bench. It shakes with the vibration the pump model measures
// at the chosen settings, in the pattern that fault makes; when nothing is
// measured (a hidden fault, or one the sensor model doesn't cover) it is drawn
// still and says why. The two figures under it are the point of the page: on a
// noisy floor a healthy pump reads about what a faulty one does.

import { times } from "../../lib/format";
import { useReducedMotion } from "../../lib/hooks";
import { MachineScene, patternFor } from "../../ui/machine/MachineScene";
import { PumpDrawing } from "../../ui/machine/PumpDrawing";
import { SourceTag } from "../../ui/SourceTag";
import type { FaultChoice } from "./options";
import { usePreview } from "./usePreview";
import s from "./Specimen.module.css";

const STILL: Record<string, string> = {
  hidden: "What's wrong is hidden, so the pump is drawn still here. The case page shakes it with the measured vibration.",
  "off-list": "The sensor model doesn't cover this fault, so nothing is measured here and the pump is drawn still.",
  unavailable: "This server can't measure these settings, so the pump is drawn still.",
  loading: "Measuring the pump model…",
};

export function Specimen({
  choice,
  severity,
  floor,
  className,
}: {
  choice: FaultChoice;
  severity: number;
  floor: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const preview = usePreview(choice, severity, floor);
  const ready = preview.kind === "ready" ? preview : null;

  return (
    <figure className={[s.specimen, className].filter(Boolean).join(" ")}>
      <MachineScene
        className={s.scene}
        vibration={ready ? ready.level : 1}
        pattern={ready ? patternFor(choice) : "steady"}
        reduceMotion={reduce || !ready}
        fallback={<PumpDrawing />}
      />
      <figcaption className={s.caption} aria-live="polite">
        {ready ? (
          <>
            <dl className={s.levels}>
              {choice !== "healthy" && (
                <div>
                  <dt>This setting</dt>
                  <dd>{times(ready.level)}</dd>
                </div>
              )}
              <div>
                <dt>Healthy, same floor</dt>
                <dd>{times(ready.healthy)}</dd>
              </div>
            </dl>
            <p className={s.source}>
              Vibration as a multiple of a healthy pump in a quiet room. <SourceTag>physics model · synthetic</SourceTag>
            </p>
          </>
        ) : (
          <p className={s.source}>{STILL[preview.kind]}</p>
        )}
      </figcaption>
    </figure>
  );
}
