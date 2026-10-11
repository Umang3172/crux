// What each machine on the line is doing now, from things that are true:
// this browser's cases and work orders, a recorded run read at the plant
// clock, and the live sensor when it is sending. P-2 is never flagged on its
// vibration level: on its noisy floor a healthy pump reads the same.

import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { getCase, streamStatus } from "../../api/crux";
import type { Investigation, MachineReplay } from "../../api/types";
import { openRequest } from "../../demo/instrument";
import { LINE, type MachineDef } from "../../demo/stories";
import { openHazards, useWorld, type CaseEntry, type WorkOrder } from "../../demo/world";
import { hours, pct } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { fault } from "../../lib/plain";
import type { TagTone } from "../../ui/Tag";
import { readClock } from "../machine/clock";
import { defaultNow, loadReplay, partAt, worstPart } from "../machine/replay";

export type Status = {
  label: string;
  tone: TagTone;
  /** Lower is more urgent: hazard, then alarms and named faults, then waiting work. */
  rank: number;
  what: string;
  figure: string;
  figureNote: string;
  action: { label: string; to?: string; story?: string };
};

export type Station = { def: MachineDef; status: Status | null };

const NOT_MONITORED: Status = {
  label: "Not monitored",
  tone: "void",
  rank: 9,
  what: "No sensor on this machine.",
  figure: "–",
  figureNote: "nothing measured",
  action: { label: "Open" },
};

export function usePlant() {
  const world = useWorld();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // Readings arrive from phones and other tabs; look again every few seconds.
    const t = window.setInterval(() => setTick((x) => x + 1), 8000);
    return () => window.clearInterval(t);
  }, []);

  const p2 = latestCase(world.cases, "p2");
  const inv = useAsync<Investigation | null>(
    () =>
      p2 && p2.kind === "engine"
        ? getCase(p2.id).catch((e) => {
            if (e instanceof ApiError && e.status === 404) return null;
            throw e;
          })
        : Promise.resolve(null),
    [p2?.id, tick],
  );
  const run = LINE.find((m) => m.id === "tb")?.recordings?.[0];
  const replay = useAsync<MachineReplay | null>(() => (run ? loadReplay(run).catch(() => null) : Promise.resolve(null)), [run]);
  const stream = useAsync(() => streamStatus("rig-01").catch(() => null), [tick]);

  const hazards = openHazards(world);
  const stations: Station[] = LINE.map((def) => {
    if (def.kind === "unmonitored") return { def, status: NOT_MONITORED };
    if (def.kind === "live") {
      const st = stream.data;
      if (!st || st.seconds <= 0) return { def, status: null };
      return {
        def,
        status: {
          label: "Live",
          tone: "safety",
          rank: 5,
          what: st.ready ? "The bench sensor is sending." : "The bench sensor is starting to send.",
          figure: `${Math.round(st.seconds)} s`,
          figureNote: `of signal at ${st.sample_rate_hz} Hz`,
          action: { label: "Open" },
        },
      };
    }
    if (def.kind === "recording") return { def, status: recordingStatus(replay.data, run, world.workOrders) };
    const hazard = p2 ? hazards.find((h) => h.caseId === p2.id) : undefined;
    return { def, status: pumpStatus(p2, inv.data, world.runs, world.workOrders, hazard?.text) };
  });

  return { stations, loading: inv.loading || replay.loading, error: inv.error ?? replay.error ?? null };
}

function latestCase(cases: CaseEntry[], machine: string): CaseEntry | undefined {
  return [...cases].filter((c) => c.machine === machine).sort((a, b) => b.createdAt - a.createdAt)[0];
}

function pumpStatus(
  entry: CaseEntry | undefined,
  inv: Investigation | null,
  runs: ReturnType<typeof useWorld>["runs"],
  orders: WorkOrder[],
  hazard: string | undefined,
): Status {
  const caseLink = entry ? `/case/${entry.id}` : undefined;
  if (hazard && entry) {
    return { label: "Hazard reported", tone: "danger", rank: 0, what: hazard, figure: "!", figureNote: "a person reported it", action: { label: "Open the case", to: caseLink } };
  }
  if (!entry) {
    return {
      label: "Not investigated yet",
      tone: "stock",
      rank: 6,
      what: "Nobody has asked Crux about this pump yet.",
      figure: "–",
      figureNote: "physics model · synthetic",
      action: { label: "Investigate", story: "one-check" },
    };
  }
  const order = orders.find((o) => o.caseId === entry.id);
  if (order) return orderStatus(order);

  // An AI run comes back whole and lives in this browser; an engine case is read from the server.
  const view = entry.kind === "ai" ? runs[entry.id]?.run.case : null;
  const outcome = view ? view.status : inv?.outcome;
  const cause = view ? (view.status === "concluded" ? view.leader : null) : inv?.conclusion?.root_cause ?? null;
  const belief = view ? view.leader_belief : inv?.conclusion?.confidence ?? null;
  if (!view && !inv) {
    return { label: "Not investigated yet", tone: "stock", rank: 6, what: "The last case was lost when the server restarted.", figure: "–", figureNote: "start it again", action: { label: "Investigate", story: "one-check" } };
  }
  if (outcome === "open") {
    const waiting = inv && openRequest(inv);
    return {
      label: waiting ? "Waiting for a check" : "Being investigated",
      tone: "measure",
      rank: 2,
      what: waiting ? "Crux can't tell two causes apart and asked for one measurement." : "Crux is testing the causes.",
      figure: "1",
      figureNote: waiting ? "check asked for" : "case open",
      action: { label: "Open the case", to: caseLink },
    };
  }
  if (outcome === "unresolved") {
    return { label: "No cause yet", tone: "stock", rank: 3, what: "Crux won't name a cause yet. Don't open it on a guess.", figure: "–", figureNote: "no verdict", action: { label: "Open the case", to: caseLink } };
  }
  if (cause === "healthy") {
    return { label: "Normal", tone: "safety", rank: 7, what: "Investigated: nothing wrong.", figure: pct(belief), figureNote: "belief it is healthy", action: { label: "Open the case", to: caseLink } };
  }
  return {
    label: "Needs attention",
    tone: "caution",
    rank: 1,
    what: `${fault(cause ?? "").name}.`,
    figure: pct(belief),
    figureNote: "belief, from the virtual experiments",
    action: { label: "Open the answer", to: `${caseLink}?stage=answer` },
  };
}

function orderStatus(o: WorkOrder): Status {
  const to = `/work-order/${o.id}`;
  if (o.stage === "closed") return { label: "Normal", tone: "safety", rank: 7, what: "Repaired; the work order is closed.", figure: o.repair ? pct(o.repair.result.belief) : "–", figureNote: o.repair ? "belief it is healthy after the repair" : "work order closed", action: { label: "Open the work order", to } };
  if (o.repair?.result.outcome === "verified") return { label: "Verified", tone: "safety", rank: 6, what: "The check after the repair verified it.", figure: pct(o.repair.result.belief), figureNote: "belief it is healthy now", action: { label: "Open the work order", to } };
  if (o.stage === "plan" && !o.approvedBy) return { label: "Work order waiting", tone: "caution", rank: 2, what: `${o.title}: waiting for a person to approve.`, figure: o.id, figureNote: "not approved yet", action: { label: "Open the work order", to } };
  return { label: "Repair being checked", tone: "caution", rank: 3, what: `${o.title}: approved by ${o.approvedBy ?? "a person"}.`, figure: o.id, figureNote: "repair under way", action: { label: "Open the work order", to } };
}

function recordingStatus(r: MachineReplay | null, run: string | undefined, orders: WorkOrder[]): Status | null {
  if (!r || !run) return null;
  const order = orders.filter((o) => o.kind === "ticket" && o.stage !== "closed").sort((a, b) => b.createdAt - a.createdAt)[0];
  if (order) return orderStatus(order);
  const now = readClock(run) ?? defaultNow(r);
  const worst = worstPart(r.parts.map((p) => partAt(p, now)));
  if (worst.alarmed) {
    const range = worst.range;
    return {
      label: "Needs attention",
      tone: "caution",
      rank: 1,
      what: `The watcher flagged ${worst.part.label.toLowerCase()}${range ? `: fix within ${hours(Math.max(0, range.p10_h))} to ${hours(range.p90_h)}` : ""}.`,
      figure: `${Math.round(worst.percent)}%`,
      figureNote: "health of the worst part",
      action: { label: "Open the machine", to: `/machine/tb?run=${encodeURIComponent(run)}` },
    };
  }
  return {
    label: "Normal",
    tone: "safety",
    rank: 7,
    what: "No alarm yet on the recorded run.",
    figure: `${Math.round(worst.percent)}%`,
    figureNote: "health of the worst part",
    action: { label: "Open the machine", to: `/machine/tb?run=${encodeURIComponent(run)}` },
  };
}
