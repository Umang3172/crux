// This site's side of learning across sites: the status the server keeps, and
// the three things a person can do with it. Nothing is invented here: alerts
// are only what the last check returned, because the status leaves applied
// alerts out.

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { fleetApprove, fleetPull, fleetRollback, fleetStatus } from "../../api/crux";
import type { FleetStatus } from "../../api/types";
import { failure, plural, versionIn } from "./words";

type Pulled = Awaited<ReturnType<typeof fleetPull>>;

export type Check =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "nohub" }
  | { state: "error"; message: string }
  | { state: "done"; alerts: Pulled["alerts"]; rejected: Pulled["rejected"]; arrived: number | null };

export type Notice = { tone: "ok" | "error"; text: string };
export type Doing = "check" | "install" | "rollback" | null;

export function useFleet() {
  const [status, setStatus] = useState<FleetStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [doing, setDoing] = useState<Doing>(null);
  /** Counts the updates that arrived in this visit; each plays the journey once. */
  const [arrival, setArrival] = useState<number | null>(null);
  /** The version a person installed in this visit, so its marker rests at "in use". */
  const [installed, setInstalled] = useState<number | null>(null);

  const load = useCallback(async (): Promise<FleetStatus | null> => {
    try {
      const next = await fleetStatus();
      setStatus(next);
      setError(null);
      return next;
    } catch (e) {
      setError(e);
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const checkForUpdates = useCallback(async () => {
    setDoing("check");
    setNotice(null);
    setCheck({ state: "busy" });
    try {
      const pulled = await fleetPull();
      const arrived = versionIn(pulled.staged);
      // Announced before the status lands, so the marker mounts at the hub, not at its resting place.
      if (arrived !== null) setArrival((n) => (n ?? 0) + 1);
      await load();
      setCheck({ state: "done", alerts: pulled.alerts, rejected: pulled.rejected, arrived });
    } catch (e) {
      // 409 is the server saying it has no hub to pull from.
      setCheck(e instanceof ApiError && e.status === 409 ? { state: "nohub" } : { state: "error", message: failure(e, "The check failed on the server.") });
    } finally {
      setDoing(null);
    }
  }, [load]);

  const install = useCallback(
    async (by: string) => {
      setDoing("install");
      setNotice(null);
      try {
        const done = await fleetApprove(by);
        await load();
        setInstalled(done.active);
        const added = done.lessons_added > 0 ? ` ${plural(done.lessons_added, "lesson")} added to memory.` : "";
        setNotice({ tone: "ok", text: `Version ${done.active} installed by ${by}.${added}` });
      } catch (e) {
        setNotice({ tone: "error", text: failure(e, "The server could not install this update.") });
      } finally {
        setDoing(null);
      }
    },
    [load],
  );

  const rollback = useCallback(
    async (by: string) => {
      setDoing("rollback");
      setNotice(null);
      try {
        const done = await fleetRollback(by);
        await load();
        setInstalled(null);
        setNotice({
          tone: "ok",
          text:
            done.active === null
              ? `Rolled back by ${by}. No update is installed now, so the built-in trend line is in use.`
              : `Rolled back by ${by}. Version ${done.active} is in use again.`,
        });
      } catch (e) {
        setNotice({ tone: "error", text: failure(e, "The server could not roll back.") });
      } finally {
        setDoing(null);
      }
    },
    [load],
  );

  return { status, error, reload: load, check, notice, doing, arrival, installed, checkForUpdates, install, rollback };
}
