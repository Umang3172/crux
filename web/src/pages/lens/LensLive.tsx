// Lens as four screens, one at a time: record, upload, watch Crux work, see
// what it found. Record films with this device's own camera; nothing plays on
// the first screen until the camera is open, so what is sent is what was
// filmed. A visitor with no machine at hand picks one of the demo clips
// (demo.ts) under the camera instead, or uploads a video. The third screen is
// driven by the steps the server streams back; the fourth by the finished scan.

import { useEffect, useRef, useState } from "react";
import { Camera, Check, RotateCcw, Upload } from "lucide-react";
import { ApiError } from "../../api/client";
import { LENS_MAX_BYTES, streamScan } from "../../api/crux";
import type { Scan } from "../../api/types";
import { Button, Callout, cx } from "../../ui/kit";
import { DEMOS, type DemoClip } from "./demo";
import { Flow } from "./Flow";
import { advance, fresh, type Runs } from "./pipeline";
import { Result } from "./Result";
import "./lens.css";

/** Longest a recording runs before it stops by itself, seconds: Lens reads about ten (docs/LENS.md). */
const RECORD_MAX_S = 10;
/** Pause on the finished pipeline before the result shows, seconds. */
const HOLD_S = 1.6;
const MAX_MB = Math.round(LENS_MAX_BYTES / (1024 * 1024));
/** Enough bits that sub-pixel motion survives compression; ten seconds stays near 10 MB, under the upload cap. */
const RECORD_BITS_PER_S = 8_000_000;

type Step = "record" | "upload" | "work" | "result";
const STEPS: { id: Step; label: string }[] = [
  { id: "record", label: "Record" },
  { id: "upload", label: "Upload" },
  { id: "work", label: "Crux reads it" },
  { id: "result", label: "What it found" },
];

type Cam = "off" | "starting" | "on" | "recording";
type Clip = { blob: Blob; url: string; demo: DemoClip | null; filename: string };

const clock = (s: number) => `00:${String(Math.floor(s)).padStart(2, "0")}`;

/** Whether this page may open the camera itself: browsers allow it only on https or localhost. */
const canFilm = () => !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

/** The container this browser records in, MP4 where it can. */
function recordType(): string {
  return ["video/mp4", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

/** A name that keeps only the clip's extension: the server stores the video under it. */
function fileName(type: string, name = ""): string {
  const ext = /\.([a-z0-9]{2,4})$/i.exec(name)?.[1] ?? (type.includes("webm") ? "webm" : type.includes("quicktime") ? "mov" : "mp4");
  return `video.${ext.toLowerCase()}`;
}

/** What the open camera actually delivers, read from the tracks rather than asked for. */
function camLine(s: MediaStream): string {
  const v = s.getVideoTracks()[0]?.getSettings() ?? {};
  const a = s.getAudioTracks()[0]?.getSettings();
  const parts = [v.frameRate ? `${Math.round(v.frameRate)} fps` : "", v.width && v.height ? `${v.width}×${v.height}` : ""];
  parts.push(a ? (a.sampleRate ? `sound ${a.sampleRate / 1000} kHz` : "sound on") : "no sound");
  return parts.filter(Boolean).join(" · ");
}

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

/**
 * `machine` names the plant machine the clip is of, so the scan is kept under it
 * (its machine page lists it, and its normal scan is compared with it); empty
 * lets the vision model name the machine. `forCase` is an investigation waiting
 * on a check this scan may answer; the result links back to it.
 */
export function LensLive({ onScanned, machine = "", forCase }: { onScanned?: (scan: Scan) => void; machine?: string; forCase?: string }) {
  const [step, setStep] = useState<Step>("record");
  const [cam, setCam] = useState<Cam>("off");
  const [camInfo, setCamInfo] = useState("");
  const [rec, setRec] = useState(0);
  const [clip, setClip] = useState<Clip | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const [runs, setRuns] = useState<Runs>(fresh);
  const [done, setDone] = useState(false);
  const [scan, setScan] = useState<Scan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const native = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const abort = useRef<AbortController | null>(null);
  const timer = useRef(0);
  const started = useRef(0);

  useEffect(
    () => () => {
      abort.current?.abort();
      window.clearInterval(timer.current);
      if (recorder.current?.state === "recording") {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  function closeCamera() {
    window.clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setCam("off");
    setCamInfo("");
    setRec(0);
  }

  async function openCamera() {
    setError(null);
    // Without camera access here (a phone on the laptop's plain http address),
    // the phone's own camera app records through the file input instead.
    if (!canFilm()) return native.current?.click();
    setCam("starting");
    const want: MediaTrackConstraints = { facingMode: "environment", frameRate: { ideal: 60 }, width: { ideal: 1920 }, height: { ideal: 1080 } };
    let s: MediaStream;
    try {
      // Sound feeds the bearing check; a camera with no microphone still films.
      s = await navigator.mediaDevices.getUserMedia({ video: want, audio: true }).catch(() => navigator.mediaDevices.getUserMedia({ video: want }));
    } catch (e) {
      setCam("off");
      const name = (e as Error).name;
      return setError(
        name === "NotAllowedError"
          ? "The browser was not allowed to use the camera. Allow it in the address bar, or upload a video."
          : name === "NotFoundError"
            ? "This device has no camera. Upload a video, or try a clip below."
            : `The camera did not open (${name}).`,
      );
    }
    stream.current = s;
    setCamInfo(camLine(s));
    setCam("on");
    const v = video.current;
    if (v) {
      v.srcObject = s;
      void v.play().catch(() => undefined);
    }
  }

  function startRecording() {
    const s = stream.current;
    if (!s) return;
    const type = recordType();
    const r = new MediaRecorder(s, { mimeType: type || undefined, videoBitsPerSecond: RECORD_BITS_PER_S });
    const parts: Blob[] = [];
    r.ondataavailable = (e) => {
      if (e.data.size) parts.push(e.data);
    };
    r.onstop = () => {
      const blob = new Blob(parts, { type: r.mimeType || type || "video/webm" });
      closeCamera();
      if (!blob.size) return setError("The camera sent nothing. Record again.");
      if (blob.size > LENS_MAX_BYTES) return setError(`That recording is over ${MAX_MB} MB. Record a shorter clip.`);
      setClip({ blob, url: URL.createObjectURL(blob), demo: null, filename: fileName(blob.type) });
      setStep("upload");
    };
    recorder.current = r;
    r.start();
    setCam("recording");
    started.current = performance.now();
    timer.current = window.setInterval(() => {
      const t = (performance.now() - started.current) / 1000;
      setRec(t);
      if (t >= RECORD_MAX_S) stopRecording();
    }, 100);
  }

  function stopRecording() {
    window.clearInterval(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  function pick(d: DemoClip) {
    setError(null);
    setFetching(d.id);
    void fetch(d.src)
      .then((r) => {
        if (!r.ok) throw new Error(`The clip "${d.title}" is missing from this build.`);
        return r.blob();
      })
      .then((blob) => {
        closeCamera();
        setClip({ blob, url: d.src, demo: d, filename: "video.mp4" });
        setStep("upload");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setFetching(null));
  }

  function own(f: File | undefined) {
    if (file.current) file.current.value = "";
    if (native.current) native.current.value = "";
    if (!f) return;
    if (f.size > LENS_MAX_BYTES) return setError(`Keep the clip under ${MAX_MB} MB: about ten seconds at 1080p.`);
    setError(null);
    closeCamera();
    setClip({ blob: f, url: URL.createObjectURL(f), demo: null, filename: fileName(f.type, f.name) });
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
      const finished = await streamScan(clip.blob, machine, (s) => setRuns((r) => advance(r, s, performance.now())), ctl.signal, clip.filename);
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
    closeCamera();
    if (clip && !clip.demo) URL.revokeObjectURL(clip.url);
    setClip(null);
    setScan(null);
    setDone(false);
    setRuns(fresh());
    setError(null);
    setStep("record");
  }

  const live = cam === "on" || cam === "recording";
  const pickers = (
    <>
      <input ref={file} type="file" accept="video/*" hidden onChange={(e) => own(e.target.files?.[0])} />
      <input ref={native} type="file" accept="video/*" capture="environment" hidden onChange={(e) => own(e.target.files?.[0])} />
    </>
  );

  return (
    <section className="ll-wizard" data-step={step}>
      <StepBar step={step} />

      {step === "record" && (
        <div className="ll-screen ll-record-screen">
          <div className={cx("ll-phone", cam === "recording" && "is-rec")} data-live={live || undefined}>
            <video ref={video} className="ll-live" muted playsInline hidden={!live} aria-label="What the camera sees" />
            <span className="ll-guides" aria-hidden />
            {!live && (
              <div className="ll-aim">
                <Camera size={22} aria-hidden />
                <p>
                  Film the running machine for about ten seconds.
                  <br />
                  Keep a still wall or floor in view, so Crux can take out your hand's shake.
                </p>
              </div>
            )}
            {cam === "recording" && (
              <span className="ll-rec" role="status">
                <i aria-hidden /> REC {clock(rec)} / {clock(RECORD_MAX_S)}
              </span>
            )}
            {camInfo && <span className="ll-cam-info">{camInfo}</span>}
          </div>

          <div className="ll-record-row">
            {live ? (
              <>
                <button
                  type="button"
                  className="ll-record"
                  data-on={cam === "recording" || undefined}
                  onClick={cam === "recording" ? stopRecording : startRecording}
                  aria-label={cam === "recording" ? "Stop recording" : "Record"}
                >
                  <span aria-hidden />
                </button>
                <div className="col gap-1">
                  <b className="ll-record-label">{cam === "recording" ? "Recording…" : `Record up to ${RECORD_MAX_S} s`}</b>
                  {cam === "recording" ? (
                    <span className="small dim">Tap to stop early</span>
                  ) : (
                    <button type="button" className="ll-link small" onClick={closeCamera}>
                      Close the camera
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <Button size="lg" variant="primary" icon={<Camera size={16} />} busy={cam === "starting"} onClick={() => void openCamera()}>
                  Open the camera
                </Button>
                <button type="button" className="ll-link small" onClick={() => file.current?.click()}>
                  or upload a video from this device
                </button>
              </>
            )}
            {pickers}
          </div>
          {error && <Callout tone="danger">{error}</Callout>}

          <div className="ll-demos">
            <h3 className="ll-demos-head">No machine at hand? Send a clip</h3>
            <div className="ll-demo-grid">
              {DEMOS.map((d) => (
                <button key={d.id} type="button" className="ll-demo" onClick={() => pick(d)} disabled={fetching !== null || cam === "recording"} aria-busy={fetching === d.id || undefined}>
                  <img src={d.poster} alt="" loading="lazy" />
                  <span className="ll-demo-text">
                    <b>{d.title}</b>
                    <span className="tiny dim">{fetching === d.id ? "Loading…" : `${d.generated ? "Generated" : "Filmed"} · ${d.credit}`}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === "upload" && clip && (
        <div className="ll-screen ll-upload-screen">
          <div className="ll-phone">
            <video src={clip.url} muted loop playsInline autoPlay preload="auto" aria-label={clip.demo ? `The demo clip: ${clip.demo.what}` : "The recorded clip"} />
          </div>
          <div className="ll-upload-side">
            <h2 className="ll-title">Clip ready</h2>
            <p className="small dim">
              {(clip.blob.size / 1e6).toFixed(1)} MB · {clip.demo ? clip.demo.what : "your video"}
              {clip.demo?.generated ? " (generated, for the demo)" : ""}
            </p>
            <div className="row gap-2 row-wrap">
              <Button variant="primary" icon={<Upload size={14} />} onClick={() => void upload()}>
                Upload
              </Button>
              <Button variant="ghost" icon={<RotateCcw size={13} />} onClick={again}>
                {clip.demo ? "Pick another" : "Retake"}
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
          <Result scan={scan} clip={clip?.demo ?? null} onAgain={again} forCase={forCase} />
        </div>
      )}
    </section>
  );
}
