// A machine with no sensor. Crux has nothing to read from it, so the page says
// that plainly and offers nothing to investigate.

import type { MachineDef } from "../../demo/stories";
import { ButtonLink } from "../../ui/Button";
import { Field, Fields, Tag } from "../../ui/Tag";
import { MachineHead } from "./MachineHead";
import s from "./Unmonitored.module.css";

export function Unmonitored({ def }: { def: MachineDef }) {
  return (
    <div className={s.page}>
      <MachineHead name={def.name} type={def.type} />
      <div className={s.body}>
        <Tag tone="void" head="Not monitored" aria-label={`${def.name} has no sensor`}>
          <Fields columns={1}>
            <Field label="Sensor" wide>
              No sensor on this machine. Crux has nothing to read from it, so it says nothing about how it is running.
            </Field>
          </Fields>
        </Tag>
        <ButtonLink to="/">Back to the plant</ButtonLink>
      </div>
    </div>
  );
}
