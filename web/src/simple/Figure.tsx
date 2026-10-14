// The machine in 3D, drawn with the anatomy kit's isometric figures: the
// motor and pump set for the modelled machines (drag to turn it), the bearing
// for a part watched over its life, the sensor rig for the live motor. The
// part a verdict names is drawn red. Each figure says when it is an
// illustration rather than this exact machine.

import { BearingFigure } from "../figures/bearing/BearingFigure";
import { SensorFigure } from "../figures/sensor/SensorFigure";
import { SkidFigure } from "../figures/skid/SkidFigure";
import type { PartId } from "../figures/skid/model";
import type { CaseModel } from "../lib/casemodel";
import { useCatalogue, useMachineModel } from "../lib/hooks";
import { fault } from "../lib/plain";
import type { PlantMachine } from "../lib/plant";

/** Where on the motor and pump set each cause lives. */
function partFor(kind: string | undefined): PartId | null {
  switch (fault(kind ?? "").part) {
    case "coupling":
      return "coupling";
    case "feet":
      return "looseBolt";
    case "impeller":
      return "casing";
    case "bearing":
    case "bearing-inner":
    case "bearing-outer":
    case "bearing-ball":
      return "motor";
    default:
      return null;
  }
}

export function MachineFigure({ m, model }: { m: PlantMachine; model: CaseModel | null }) {
  const twin = useMachineModel();
  const tests = useCatalogue();

  if (m.mode === "life" && twin.data) {
    return (
      <>
        <BearingFigure model={twin.data} />
        <p className="mn-stage-note">The bearing inside this part. Drag the speed to watch the balls pass the damage.</p>
      </>
    );
  }
  if (m.mode === "live" && tests.data && twin.data) {
    return (
      <>
        <SensorFigure tests={tests.data} blades={twin.data.blade_count} />
        <p className="mn-stage-note">Where a sensor goes for each check Crux can ask for.</p>
      </>
    );
  }

  const rpm = m.mode === "model" ? (m.rpm ?? twin.data?.nominal_rpm) : undefined;
  const found = model?.status === "concluded" && model.leader && model.leader.kind !== "healthy" ? model.leader.kind : undefined;
  const part = partFor(found);
  const where = found ? fault(found).partName : null;
  return (
    <>
      <SkidFigure part={part} shakes={!!found} readout={where ? where.replace(/^the /, "") : rpm ? `${Math.round(rpm).toLocaleString()} rpm` : ""} title={m.name} />
      <p className="mn-stage-note">
        {m.mode === "model"
          ? found
            ? `Drawn in red: ${where}. Drag sideways to turn the machine.`
            : "Drag sideways to turn the machine."
          : "An illustration of a motor-driven set. This machine has no model of its own yet."}
      </p>
    </>
  );
}
