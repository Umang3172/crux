// The scan, one step at a time: send a clip, confirm the shaft speed, read what
// Crux found. The server keeps the scan; this keeps where the person is.

import { useCallback, useState } from "react";
import { LENS_MAX_BYTES, uploadScan } from "../../../api/crux";
import type { Scan, ScanAnalysis } from "../../../api/types";
import { num } from "../../../lib/format";
import { lensFailure } from "../../scans/words";

/** What Crux reads of a clip. Longer ones only cost the server time and say no more. */
export const MAX_SECONDS = 12;

export type Stage = "clip" | "speed" | "found";

const MB = 1024 * 1024;

/** The clip's length from its own header, or null when this browser can't read the format. */
function clipSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (v: number | null) => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = window.setTimeout(() => done(null), 4000);
    video.preload = "metadata";
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}

/** A reason to turn the file back before it travels, or null when it can go. */
async function refuse(file: File): Promise<string | null> {
  if (file.size === 0) return "That file is empty. Record the clip again, or choose a different one.";
  if (file.type && !file.type.startsWith("video/")) return "That file isn't a video. Record a clip, or choose a video from your phone.";
  if (file.size > LENS_MAX_BYTES) {
    return `That video is ${num(file.size / MB, 1)} MB, and this server takes up to ${LENS_MAX_BYTES / MB} MB. Record about ten seconds at 1080p or lower, and try again.`;
  }
  const length = await clipSeconds(file);
  if (length !== null && length > MAX_SECONDS + 0.5) {
    return `That clip runs ${Math.round(length)} seconds. Crux reads up to ${MAX_SECONDS}: record a shorter one.`;
  }
  return null;
}

export function useFlow(initialMachine: string) {
  const [machine, setMachine] = useState(initialMachine);
  const [scan, setScan] = useState<Scan | null>(null);
  const [analysis, setAnalysis] = useState<ScanAnalysis | null>(null);
  /** 0 to 1 while the clip travels, then 1 while the server reads it; null otherwise. */
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stage: Stage = analysis ? "found" : scan ? "speed" : "clip";

  const send = useCallback(
    async (file: File) => {
      setError(null);
      const why = await refuse(file);
      if (why) {
        setError(why);
        return;
      }
      setProgress(0);
      try {
        setScan(await uploadScan(file, machine.trim(), setProgress));
      } catch (e) {
        setError(lensFailure(e, "The clip could not be sent."));
      } finally {
        setProgress(null);
      }
    },
    [machine],
  );

  /** Start over for another machine or another take; the name stays, so scans of one machine share it. */
  const again = useCallback(() => {
    setScan(null);
    setAnalysis(null);
    setError(null);
  }, []);

  return { stage, machine, setMachine, scan, setScan, analysis, setAnalysis, progress, error, send, again };
}
