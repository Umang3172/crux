// Step two: what Crux saw in the clip, and the speed a person confirms. The
// model's reading is shown and marked unconfirmed; the physics measures inside
// the blue box, which a tap on the picture moves.

import { useState } from "react";
import type { Box, Scan, ScanAnalysis } from "../../../api/types";
import { ConfirmSpeed } from "../../scans/ConfirmSpeed";
import { ModelLook } from "../../scans/ModelLook";
import { ScanFigure } from "../../scans/ScanFigure";
import { Field, Fields, Tag } from "../../../ui/Tag";

export function Speed({ scan, onAnalysed }: { scan: Scan; onAnalysed: (a: ScanAnalysis) => void }) {
  const [box, setBox] = useState<Box>(scan.box);
  return (
    <>
      <ScanFigure scan={scan} box={box} onBox={setBox} />
      <Tag tone="written" head="Camera look" aria-label="What the camera look saw">
        <Fields columns={1}>
          <Field label="What a model saw: unconfirmed">
            <ModelLook scan={scan} />
          </Field>
        </Fields>
      </Tag>
      <Tag tone="measure" head="Speed" aria-label="Confirm the shaft speed">
        <Fields columns={1}>
          <Field label="Confirm">
            <ConfirmSpeed scan={scan} box={box} onAnalysed={onAnalysed} />
          </Field>
        </Fields>
      </Tag>
    </>
  );
}
