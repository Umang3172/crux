// Lens as four screens, one at a time: record, upload, watch Crux work, see
// what it found. Record sends the demo clip (demo.ts) the way a phone would;
// "a video from this device" sends any clip the same way. The third screen is
// driven by the steps the server streams back; the fourth by the finished scan.

import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw, Upload } from "lucide-react";
import { ApiError } from "../../api/client";
import { LENS_MAX_BYTES, streamScan } from "../../api/crux";
import type { Scan } from "../../api/types";
import { Button, Callout, cx } from "../../ui/kit";
import { DEMO, type DemoClip } from "./demo";
import { Flow } from "./Flow";
import { advance, fresh, type Runs } from "./pipeline";
import { Result } from "./Result";
import "./lens.css";

/** Longest the viewfinder records before it stops by itself, seconds. */
const RECORD_MAX_S = 4;
/** Pause on the finished pipeline before the result shows, seconds. */
const HOLD_S = 1.6;
const MAX_MB = Math.round(LENS_MAX_BYTES / (1024 * 1024));

type Step = "record" | "upload" | "work" | "result";
const STEPS: { id: Step; label: string }[] = [
  { id: "record", label: "Record" },
  { id: "upload", label: "Upload" },
  { id: "work", label: "Crux reads it" },
  { id: "result", label: "What it found" },
];

const clock = (s: number) => `00:${String(Math.floor(s)).padStart(2, "0")}`;

function StepBar({ step }: { step: Step }) {
  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="ll-steps" aria-label="Steps">
      {STEPS.map((s, i) => (
        <li key={s.id} data-state={i < at ? "done" : i === at ? "now" : "next"} aria-current={i === at ? "step" : undefined}>
          <span className="ll-step-dot">{i < at ? <Check size={11} aria-hidden /> : i + 1}</span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

export function LensLive({ onScanned }: { onScanned?: (scan: Scan) => void }) {
  const [step, setStep] = useState<Step>("record");
  const [recording, setRecording] = useState(false);
  const [rec, setRec] = useState(0);
  const [clip, setClip] = useState<{ blob: Blob; url: string; demo: DemoClip | null } | null>(null);
  const [runs, setRuns] = useState<Runs>(fresh);
  const [done, setDone] = useState(false);
  const [scan, setScan] = useState<Scan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const timer = useRef(0);
  const started = useRef(0);

  useEffect(
    () => () => {
      abort.current?.abort();
      window.clearInterval(timer.current);
    },
    [],
  );

  function stop() {
    window.clearInterval(timer.current);
    setRecording(false);
    setRec(0);
    void fetch(DEMO.src)
      .then((r) => {
        if (!r.ok) throw new Error("The demo clip is missing from this build.");
        return r.blob();
      })
      .then((blob) => {
        setClip({ blob, url: DEMO.src, demo: DEMO });
        setStep("upload");
      })
      .catch((e: Error) => setError(e.message));
  }

  function record() {
    if (recording) return stop();
    setError(null);
    setRecording(true);
    const v = video.current;
    if (v) {
      v.currentTime = 0;
      void v.play().catch(() => undefined);
    }
    started.current = performance.now();
    timer.current = window.setInterval(() => {
      const s = (performance.now() - started.current) / 1000;
      setRec(s);
      if (s >= RECORD_MAX_S) stop();
    }, 100);
  }

  function own(f: File | undefined) {
    if (file.current) file.current.value = "";
    if (!f) return;
    if (f.size > LENS_MAX_BYTES) return setError(`Keep the clip under ${MAX_MB} MB: about ten seconds at 1080p.`);
    setError(null);
    setClip({ blob: f, url: URL.createObjectURL(f), demo: null });
    setStep("upload");
  }

  async function upload() {
    if (!clip) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setError(null);
    setScan(null);
    setDone(false);
    setStep("work");
    const t0 = performance.now();
    setRuns({ ...fresh(), clip: { status: "done", started: t0, ended: t0, line: `${(clip.blob.size / 1e6).toFixed(1)} MB sent`, who: clip.demo ? "demo clip" : "your clip" } });
    try {
      const finished = await streamScan(clip.blob, "", (s) => setRuns((r) => advance(r, s, performance.now())), ctl.signal);
      setScan(finished);
      setDone(true);
      onScanned?.(finished);
      window.setTimeout(() => setStep((now) => (now === "work" ? "result" : now)), HOLD_S * 1000);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof ApiError && e.status === 501 ? "Video support is not installed on this server." : (e as Error).message);
    }
  }

  function again() {
    abort.current?.abort();
    window.clearInterval(timer.current);
    if (clip && !clip.demo) URL.revokeObjectURL(clip.url);
    setRecording(false);
    setClip(null);
    setScan(null);
    setDone(false);
    setRuns(fresh());
    setError(null);
    setStep("record");
  }

  const picker = (
    <>
      <input ref={file} type="file" accept="video/*" hidden onChange={(e) => own(e.target.files?.[0])} />
      <button type="button" className="ll-link small" onClick={() => file.current?.click()}>
        or upload a video from this device
      </button>
    </>
  );

  return (
    <section className="ll-wizard" data-step={step}>
      <StepBar step={step} />

      {step === "record" && (
        <div className="ll-screen ll-record-screen">
          <div className={cx("ll-phone", recording && "is-rec")}>
            <video ref={video} src={DEMO.src} muted loop playsInline autoPlay preload="auto" aria-label={`The viewfinder: ${DEMO.what}`} />
            <span className="ll-guides" aria-hidden />
            {recording && (
              <span className="ll-rec" role="status">
                <i aria-hidden /> REC {clock(rec)}
              </span>
            )}
          </div>
          <div className="ll-record-row">
            <button type="button" className="ll-record" data-on={recording || undefined} onClick={record} aria-label={recording ? "Stop recording" : "Record"}>
              <span aria-hidden />
            </button>
            <div className="col gap-1">
              <b className="ll-record-label">{recording ? "Recording…" : "Record the machine"}</b>
              <span className="small dim">
                Demo clip: {DEMO.what}
                {DEMO.generated ? " (generated, for the demo)" : ""} ·{" "}
                {DEMO.creditUrl ? (
                  <a href={DEMO.creditUrl} target="_blank" rel="noreferrer">
                    {DEMO.credit}
                  </a>
                ) : (
                  DEMO.credit
                )}
              </span>
              {!recording && picker}
            </div>
          </div>
          {error && <Callout tone="danger">{error}</Callout>}
        </div>
      )}

      {step === "upload" && clip && (
        <div className="ll-screen ll-upload-screen">
          <div className="ll-phone">
            <video src={clip.url} muted loop playsInline autoPlay preload="auto" aria-label="The recorded clip" />
          </div>
          <div className="ll-upload-side">
            <h2 className="ll-title">Clip ready</h2>
            <p className="small dim">
              {(clip.blob.size / 1e6).toFixed(1)} MB · {clip.demo ? clip.demo.what : "your video"}
            </p>
            <div className="row gap-2 row-wrap">
              <Button variant="primary" icon={<Upload size={14} />} onClick={() => void upload()}>
                Upload
              </Button>
              <Button variant="ghost" icon={<RotateCcw size={13} />} onClick={again}>
                Retake
              </Button>
            </div>
            {error && <Callout tone="danger">{error}</Callout>}
          </div>
        </div>
      )}

      {step === "work" && (
        <div className="ll-screen ll-work-screen">
          <div className="ll-work-head">
            <h2 className="ll-title">{done ? "Done" : error ? "Stopped" : "Crux is reading the clip"}</h2>
            {done && scan && (
              <Button size="sm" variant="primary" onClick={() => setStep("result")}>
                See what it found
              </Button>
            )}
          </div>
          <Flow runs={runs} label="The Lens pipeline, step by step" />
          {error && (
            <div className="row gap-2 row-wrap">
              <Callout tone="danger">{error}</Callout>
              <Button size="sm" onClick={again}>
                Start again
              </Button>
            </div>
          )}
        </div>
      )}

      {step === "result" && scan && (
        <div className="ll-screen">
          <Result scan={scan} clip={clip?.demo ?? null} onAgain={again} />
        </div>
      )}
    </section>
  );
}
