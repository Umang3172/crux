// The demo pump now: the physics model's pump at rest, a tag for where it
// stands, this browser's cases on it and what the server remembers of earlier
// ones. The scene moves only with a reading from a case, so here it is at rest
// and never flags the pump on a vibration level that a noisy floor can fake.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useDataNote } from "../../app/DataNote";
import { launchStory } from "../../demo/launch";
import { story, type MachineDef } from "../../demo/stories";
import { useWorld } from "../../demo/world";
import { useReducedMotion } from "../../lib/hooks";
import { Button, ButtonLink } from "../../ui/Button";
import { MachineScene } from "../../ui/machine/MachineScene";
import { SourceTag } from "../../ui/SourceTag";
import { Field, Fields, Tag } from "../../ui/Tag";
import { CaseList } from "./CaseList";
import { EarlierCases } from "./EarlierCases";
import { MachineHead } from "./MachineHead";
import { nowStatus } from "./nowStatus";
import { useCaseSummaries } from "./useCaseSummaries";
import s from "./NowView.module.css";

const NOTE =
  "P-2 is a physics model with a fault fed in, so every reading of it is synthetic (12 kHz). The cases listed are the ones this browser opened.";

export function NowView({ def }: { def: MachineDef }) {
  const navigate = useNavigate();
  const world = useWorld();
  const reduce = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDataNote(NOTE);

  const entries = useMemo(() => world.cases.filter((c) => c.machine === def.id).sort((a, b) => b.createdAt - a.createdAt), [world.cases, def.id]);
  const cases = useCaseSummaries(entries, world.runs);
  const status = nowStatus(world, def.id, cases);
  const open = cases.find((c) => c.phase === "waiting" || c.phase === "investigating");
  const order = world.workOrders.filter((w) => w.machine === def.id && w.stage !== "closed").sort((a, b) => b.createdAt - a.createdAt)[0];
  // Earlier cases come from the newest case that carries any.
  const history = cases.find((c) => c.history.length > 0)?.history ?? [];

  async function investigate() {
    const one = story("one-check");
    if (!one) return;
    setBusy(true);
    setError(null);
    try {
      navigate(await launchStory(one));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The case could not start.");
      setBusy(false);
    }
  }

  return (
    <div className={s.page}>
      <MachineHead name={def.name} type={def.type}>
        <SourceTag>{def.source}</SourceTag>
      </MachineHead>
      <div className={s.grid}>
        <figure className={s.stage}>
          <MachineScene
            className={s.scene}
            vibration={1}
            marker={cases[0]?.phase === "waiting" ? "bearing" : null}
            reduceMotion={reduce}
            fallback={<p className={s.noscene}>The 3D view needs WebGL, which this browser does not have.</p>}
          />
          <figcaption className={s.caption}>
            The pump set as the physics model draws it, at rest: the scene moves only with a reading from a case.
          </figcaption>
          <dl className={s.facts}>
            <div>
              <dt>Drive-end bearing</dt>
              <dd>SKF 6205-2RS JEM, as the model simulates it</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{def.source}</dd>
            </div>
          </dl>
        </figure>
        <div className={s.side}>
          <Tag tone={status.tone} head={status.label} aria-label="The pump now" aria-live="polite">
            <Fields columns={1}>
              <Field label="Now" wide>
                {status.detail}
              </Field>
            </Fields>
            <div className={s.foot}>
              <div className={s.buttons}>
                {open ? (
                  <ButtonLink to={`/case/${open.id}`} kind="primary" size="l">
                    Open the case
                  </ButtonLink>
                ) : (
                  <Button kind="primary" size="l" onClick={investigate} busy={busy} disabled={busy}>
                    {busy ? "Starting…" : "Investigate now"}
                  </Button>
                )}
                {order && (
                  <ButtonLink to={`/work-order/${order.id}`} size="l">
                    Open work order {order.id}
                  </ButtonLink>
                )}
              </div>
              {!open && <p className={s.help}>Runs the pump model with a fault fed in for the demo, tests every suspect cause on a virtual copy, and asks for one check when it can't tell.</p>}
              {error && (
                <p className={s.error} role="alert">
                  {error}
                </p>
              )}
              <ButtonLink to="/try" kind="quiet">
                Break the pump yourself
              </ButtonLink>
            </div>
          </Tag>
        </div>
      </div>
      <div className={s.lists}>
        <CaseList cases={cases} />
        <EarlierCases history={history} />
      </div>
    </div>
  );
}
