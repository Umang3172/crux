// What Crux is investigating right now, for the top bar. Present only while
// something really is under way: a shift being investigated, or a run of
// Crux's AI that this page is still receiving.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { getLiveRun } from "../lib/liveruns";
import { machineById, machineOfCase, type PlantMachine } from "../lib/plant";
import { useSession } from "../lib/session";
import { useShift } from "../lib/shift";
import { CountUp, cx } from "../ui/kit";

export type LiveItem = { machine: PlantMachine; caseId?: string };

export function useLiveNow(): LiveItem[] {
  const shift = useShift();
  const session = useSession();
  const items: LiveItem[] = [];
  for (const it of shift?.items ?? []) {
    const machine = machineById(it.machine);
    if (machine && (it.state === "running" || it.state === "showing")) items.push({ machine, caseId: it.caseId });
  }
  for (const c of session.cases) {
    // A run whose stream this page no longer holds (it was reloaded) is not happening; its investigation says so.
    if (c.kind !== "agents" || c.run || c.failed || !getLiveRun(c.id)?.streaming) continue;
    if ((shift && c.batch === shift.id) || items.some((i) => i.caseId === c.id)) continue;
    items.push({ machine: machineOfCase(c), caseId: c.id });
  }
  return items;
}

export function LivePill() {
  const items = useLiveNow();
  const on = items.length > 0;
  // The last thing shown stays a moment after it ends, so its leaving can be seen.
  const last = useRef<LiveItem[]>(items);
  if (on) last.current = items;
  const [mounted, setMounted] = useState(on);
  useEffect(() => {
    if (on) return setMounted(true);
    const t = window.setTimeout(() => setMounted(false), 200);
    return () => window.clearTimeout(t);
  }, [on]);
  if (!on && !mounted) return null;

  const shown = on ? items : last.current;
  const one = shown.length === 1 ? shown[0] : null;
  const what = one ? one.machine.short : `${shown.length} machines`;
  return (
    <Link to={one?.caseId ? `/cases/${one.caseId}` : "/plant"} viewTransition className={cx("live-pill", !on && "leaving")} aria-label={`Investigating ${what}`} title={`Investigating ${what}`}>
      <span className="live-dot" aria-hidden />
      <span className="live-word">Investigating</span>
      <b>
        {one ? one.machine.short : <CountUp value={shown.length} ms={300} format={(n) => `${Math.round(n)} machines`} />}
        {"…"}
      </b>
    </Link>
  );
}
