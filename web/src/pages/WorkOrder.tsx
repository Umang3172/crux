// A work order: an answer turned into an approved repair, a check that the
// repair worked, and what was found. The order is itself a tag: yellow while
// open, green once the repair is verified, red while a hazard stands.

import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useDataNote } from "../app/DataNote";
import { brainOf } from "../app/ai";
import { machineDef } from "../demo/stories";
import { useWorld, type WorkOrder as Order, type WorkOrderStage } from "../demo/world";
import { shortId, stamp } from "../lib/format";
import { useHealth } from "../lib/hooks";
import { fault } from "../lib/plain";
import { pct } from "../lib/format";
import { ButtonLink } from "../ui/Button";
import { StageLine } from "../ui/StageLine";
import { Empty, ErrorState, Loading } from "../ui/States";
import { Tag } from "../ui/Tag";
import { CasePlan } from "./workorder/CasePlan";
import { CheckStage } from "./workorder/CheckStage";
import { ClosedStage } from "./workorder/ClosedStage";
import { FoundStage } from "./workorder/FoundStage";
import { hazardOn } from "./workorder/hazard";
import type { FleetOutcome } from "./workorder/LessonResult";
import { isStage, OUTCOME, recordingSource, stageOf, stagesFor, tagTone } from "./workorder/model";
import { RepairRecorded } from "./workorder/RepairRecorded";
import { RepairStage } from "./workorder/RepairStage";
import { TicketPlan } from "./workorder/TicketPlan";
import { useCaseCore } from "./workorder/useCaseCore";
import { useTicket } from "./workorder/useTicket";
import w from "./WorkOrder.module.css";

export default function WorkOrder() {
  const { id } = useParams();
  const world = useWorld();
  const wo = world.workOrders.find((o) => o.id === id);
  useDataNote("Work orders are kept in this browser. Recorded runs are replays; the demo pump is a physics model.");
  if (!wo) {
    return (
      <Empty title="No work order here">
        <p>Work orders live in the browser that drafted them. Draft one from a case's answer or from a forecast on a recorded run.</p>
        <p>
          <Link to="/work-orders">This browser's work orders</Link>
        </p>
      </Empty>
    );
  }
  return <View key={wo.id} wo={wo} />;
}

function View({ wo }: { wo: Order }) {
  const world = useWorld();
  const health = useHealth();
  const [search, setSearch] = useSearchParams();
  const [lesson, setLesson] = useState<{ result: FleetOutcome; major: boolean } | null>(null);
  const core = useCaseCore(wo);
  const tk = useTicket(wo.kind === "ticket" ? wo.ticketId : undefined);

  const stages = stagesFor(wo.kind);
  const index = (st: WorkOrderStage) => stages.findIndex((x) => x.id === st);
  const reached = stageOf(wo);
  const asked = search.get("stage");
  const stage: WorkOrderStage = isStage(asked) && index(asked) >= 0 && index(asked) <= index(reached) ? asked : reached;
  const go = (st: WorkOrderStage) =>
    setSearch((p) => {
      p.set("stage", st);
      return p;
    });

  const hazard = hazardOn(
    world,
    wo.caseId,
    core.hazard ?? (tk.ticket?.hazard ? "The camera look may show a hazard on this machine (unconfirmed: check before acting)." : null),
    core.notes,
  );
  const machineName = machineDef(wo.machine)?.name ?? tk.ticket?.machine_name ?? wo.machine;
  const writer = brainOf(health.data?.models.lesson_writer);
  const said =
    wo.kind === "case"
      ? core.cause
        ? `Crux named ${fault(core.cause).name.toLowerCase()} at ${pct(core.belief)}${wo.repair ? `; the check after the repair: ${OUTCOME[wo.repair.result.outcome].head.toLowerCase()}` : ""}.`
        : wo.repair
          ? `The check after the repair: ${OUTCOME[wo.repair.result.outcome].head.toLowerCase()}.`
          : ""
      : tk.ticket
        ? `The forecast said ${tk.ticket.part_label.toLowerCase()} needed attention at hour ${tk.ticket.at_h.toFixed(1)}.`
        : "";

  let body: React.ReactNode;
  const ticketPlan = wo.kind === "ticket" && stage === "plan";
  if (ticketPlan && tk.loading) body = <Loading>Loading the ticket…</Loading>;
  else if (ticketPlan && tk.error) body = <ErrorState error={tk.error} onRetry={tk.reload} />;
  else if (ticketPlan && tk.missing)
    body = (
      <Empty title="The ticket is gone">
        <p>Tickets are kept in the server's memory, and the server restarted. What this work order recorded is kept in this browser.</p>
      </Empty>
    );
  else if (stage === "plan")
    body =
      wo.kind === "case" ? (
        <CasePlan wo={wo} go={go} core={core} hazard={hazard} />
      ) : (
        <TicketPlan wo={wo} go={go} ticket={tk.ticket!} onTicket={tk.set} hazard={hazard} />
      );
  else if (stage === "repair")
    body =
      wo.kind === "case" ? (
        <RepairStage wo={wo} go={go} cause={core.cause} />
      ) : (
        <RepairRecorded wo={wo} go={go} source={recordingSource(tk.ticket?.machine ?? wo.machine).long} />
      );
  else if (stage === "check") body = <CheckStage wo={wo} go={go} />;
  else if (stage === "found") body = <FoundStage wo={wo} go={go} said={said} onLesson={(result, major) => setLesson({ result, major })} />;
  else body = <ClosedStage wo={wo} machineName={machineName} lesson={lesson} writer={writer.live ? writer.name : "the template"} />;

  return (
    <div className={w.page}>
      <header className={w.head}>
        <div>
          <h1 className={w.title}>{wo.title}</h1>
          <p className={w.meta}>
            Work order {wo.id} · drafted {stamp(wo.createdAt)}
            {wo.approvedBy && wo.approvedAt ? ` · approved by ${wo.approvedBy}` : ""}
            {wo.caseId && (
              <>
                {" · "}
                <Link to={`/case/${wo.caseId}?stage=answer`}>case {shortId(wo.caseId)}</Link>
              </>
            )}
          </p>
        </div>
        <ButtonLink to="/work-orders" kind="quiet">
          All work orders
        </ButtonLink>
      </header>
      <StageLine stages={stages} reached={index(reached)} current={index(stage)} onSelect={(i) => go(stages[i].id)} label="Work order stages" />
      <Tag tone={tagTone(wo, !!hazard && !hazard.ack)} head={`Work order ${wo.id}`} as="article">
        {body}
      </Tag>
    </div>
  );
}
