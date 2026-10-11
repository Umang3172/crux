// This browser's work orders: where each one stands, and a way to open it.
// They live in the browser that drafted them, so each visitor has their own list.

import { Link, useSearchParams } from "react-router";
import { useDataNote } from "../app/DataNote";
import { machineDef } from "../demo/stories";
import { useWorld, type WorkOrder, type WorkOrderStage } from "../demo/world";
import { clock, stamp } from "../lib/format";
import { Button, ButtonLink } from "../ui/Button";
import { Empty } from "../ui/States";
import { isStage, OUTCOME, STAGE_LABEL, stageOf, stagesFor } from "./workorder/model";
import s from "./WorkOrders.module.css";

/** What the order is waiting for, or how it ended. */
function waitingFor(o: WorkOrder): string {
  switch (stageOf(o)) {
    case "plan":
      return "Waiting for approval";
    case "repair":
      return o.kind === "case" ? "Waiting for the repair" : "A recording can't be repaired";
    case "check":
      return o.repair ? OUTCOME[o.repair.result.outcome].head : "Waiting for the check";
    case "found":
      return "Waiting for what was found";
    default:
      return o.found ? (o.found.right ? "Crux was right" : "Crux was wrong") : "";
  }
}

/** The class of the stage, as a tag head would carry it: green once verified, ink when closed, yellow while open. */
const toneOf = (o: WorkOrder): "ok" | "ink" | "attention" =>
  o.repair?.result.outcome === "verified" ? "ok" : o.stage === "closed" ? "ink" : "attention";

export default function WorkOrders() {
  const world = useWorld();
  const [params, setParams] = useSearchParams();
  useDataNote("Work orders are kept in this browser: every visitor has their own list, and Reset demo clears it.");

  const asked = params.get("stage");
  const filter: WorkOrderStage | null = isStage(asked) ? asked : null;
  const orders = [...world.workOrders].sort((a, b) => b.createdAt - a.createdAt);
  const stages = stagesFor("case");
  const count = (st: WorkOrderStage) => orders.filter((o) => stageOf(o) === st).length;
  const shown = filter ? orders.filter((o) => stageOf(o) === filter) : orders;

  if (orders.length === 0) {
    return (
      <div className={s.page}>
        <h1 className={s.title}>Work orders</h1>
        <Empty title="No work orders in this browser yet">
          <div className={s.stack}>
            <p>A work order is drafted when a case ends with a cause named, or from a forecast on a recorded bearing. Finish a case, and the plan to fix it appears here.</p>
            <div className={s.actions}>
              <ButtonLink to="/" kind="primary">
                Start from the plant
              </ButtonLink>
              <ButtonLink to="/try">Break the pump yourself</ButtonLink>
            </div>
          </div>
        </Empty>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>Work orders</h1>
        <p className={s.lede}>Kept in this browser. Each one is a plan to repair a machine, approved by a person, checked afterwards, and closed once what was found is on record.</p>
      </header>

      <div className={s.filters} role="group" aria-label="Show work orders at a stage">
        <button type="button" aria-pressed={filter === null} onClick={() => setParams({}, { replace: true })}>
          All <span className={s.count}>{orders.length}</span>
        </button>
        {stages.map((st) => (
          <button key={st.id} type="button" aria-pressed={filter === st.id} onClick={() => setParams({ stage: st.id }, { replace: true })}>
            {STAGE_LABEL[st.id]} <span className={s.count}>{count(st.id)}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className={s.none}>
          <p>No work orders at this stage.</p>
          <Button kind="quiet" onClick={() => setParams({}, { replace: true })}>
            Show all
          </Button>
        </div>
      ) : (
        <table className={s.table}>
          <caption className="visually-hidden">This browser's work orders, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Machine</th>
              <th scope="col">Work order</th>
              <th scope="col">Stage</th>
              <th scope="col">Approved by</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <tr key={o.id}>
                <td data-label="Machine">{machineDef(o.machine)?.name ?? o.machine}</td>
                <td data-label="Work order">
                  <Link className={s.link} to={`/work-order/${o.id}`}>
                    {o.title || `Work order ${o.id}`}
                  </Link>
                  <span className={s.id}>{o.id}</span>
                </td>
                <td data-label="Stage">
                  <span className={s.stage}>
                    <span className={s.swatch} data-tone={toneOf(o)} aria-hidden="true" />
                    {STAGE_LABEL[stageOf(o)]}
                  </span>
                  <span className={s.note}>{waitingFor(o)}</span>
                </td>
                <td data-label="Approved by">{o.approvedBy ? `${o.approvedBy}${o.approvedAt ? `, ${clock(o.approvedAt)}` : ""}` : "Not yet"}</td>
                <td data-label="Created">{stamp(o.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
