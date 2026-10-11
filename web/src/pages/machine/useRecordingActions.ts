// The two things a person can do about a recorded bearing: investigate the
// reading at the plant clock, and draft a work order from the alarm. Neither
// makes a case on the server: an investigation of a recording is not stored,
// and a ticket becomes a work order in this browser.

import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "../../api/client";
import { createTicket, investigateRecording } from "../../api/crux";
import type { MachineReplay, PartReplay, RecordingVerdict } from "../../api/types";
import { getWorld, nextWorkOrderId, upsertWorkOrder } from "../../demo/world";

export type Inquiry =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; verdict: RecordingVerdict; atH: number; part: string }
  | { phase: "error"; message: string }
  /** The server cannot investigate this recording (its raw files are not on it). */
  | { phase: "unavailable"; reason: string };

export type Drafting = { phase: "idle" } | { phase: "running" } | { phase: "error"; message: string };

/** The title a work order drafted from this part carries, so the page can find it again. */
export const workOrderTitle = (replay: MachineReplay, part: PartReplay) => `${part.label} on ${replay.name}`;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

export function useRecordingActions({
  replay,
  part,
  atH,
  stopIn,
  pause,
}: {
  replay: MachineReplay;
  part: PartReplay;
  atH: number;
  stopIn: string;
  pause: () => void;
}) {
  const navigate = useNavigate();
  const [inquiry, setInquiry] = useState<Inquiry>({ phase: "idle" });
  const [drafting, setDrafting] = useState<Drafting>({ phase: "idle" });
  const at = Math.round(atH * 1e4) / 1e4;

  const investigate = useCallback(async () => {
    pause();
    setInquiry({ phase: "running" });
    try {
      const verdict = await investigateRecording(replay.machine, part.part, at);
      setInquiry({ phase: "done", verdict, atH: at, part: part.part });
    } catch (e) {
      // 409: the raw recording is not on this server. Say why and stop offering it.
      if (e instanceof ApiError && e.status === 409) setInquiry({ phase: "unavailable", reason: e.detail });
      else setInquiry({ phase: "error", message: messageOf(e) });
    }
  }, [pause, replay.machine, part.part, at]);

  const draft = useCallback(async () => {
    pause();
    setDrafting({ phase: "running" });
    try {
      const stop = Number(stopIn);
      const ticket = await createTicket({
        machine: replay.machine,
        part: part.part,
        at_h: at,
        stop_in_h: stopIn.trim() !== "" && Number.isFinite(stop) && stop >= 0 ? stop : undefined,
      });
      const id = nextWorkOrderId(getWorld());
      upsertWorkOrder({ id, kind: "ticket", ticketId: ticket.id, machine: "tb", title: workOrderTitle(replay, part), createdAt: Date.now(), stage: "plan" });
      navigate(`/work-order/${id}`);
    } catch (e) {
      setDrafting({ phase: "error", message: messageOf(e) });
    }
  }, [pause, replay, part, at, stopIn, navigate]);

  return { inquiry, drafting, investigate, draft };
}
