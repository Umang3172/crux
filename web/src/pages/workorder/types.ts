import type { WorkOrder, WorkOrderStage } from "../../demo/world";

/** What every stage of a work order is given: the order, and a way to move to another stage. */
export type StageProps = { wo: WorkOrder; go: (stage: WorkOrderStage) => void };
