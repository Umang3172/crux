// Step one: name the machine and film it. The two buttons open the phone's
// camera or its library; the file is checked before it travels, and the
// progress is the clip really going to the server.

import { useId, useRef } from "react";
import { LENS_MAX_BYTES } from "../../../api/crux";
import { Button } from "../../../ui/Button";
import { Field, Fields, Tag } from "../../../ui/Tag";
import { MAX_SECONDS } from "./useFlow";
import s from "./Lens.module.css";

const TIPS = [
  "Run the machine at its normal speed and film about ten seconds.",
  "Rest the phone on something solid. Keep some still wall or floor in the picture: Crux uses it to cancel your own hand shake.",
  "Use Slo-mo (120 or 240 frames a second) if your phone has it. The camera can only see motion up to half its frame rate.",
  "Keep the picture sharp and well lit, and the sound on.",
];

export function Clip({
  machine,
  onMachine,
  progress,
  error,
  onFile,
}: {
  machine: string;
  onMachine: (m: string) => void;
  progress: number | null;
  error: string | null;
  onFile: (f: File) => void;
}) {
  const id = useId();
  const record = useRef<HTMLInputElement>(null);
  const choose = useRef<HTMLInputElement>(null);
  const named = machine.trim() !== "";
  const sending = progress !== null;

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared so the same file can be picked again after a refusal.
    e.target.value = "";
    if (file) onFile(file);
  };

  return (
    <Tag tone="measure" head="Clip" aria-label="Name the machine and film it">
      <Fields columns={1}>
        <Field label="Machine">
          <div className={s.stack}>
            <label className="visually-hidden" htmlFor={id}>
              Machine name
            </label>
            <input
              id={id}
              className={s.input}
              value={machine}
              onChange={(e) => onMachine(e.target.value)}
              placeholder="Cooling fan 3"
              autoComplete="off"
              aria-describedby={`${id}-hint`}
              disabled={sending}
            />
            <p id={`${id}-hint`} className={s.hint}>
              Scans with the same name are compared with each other, so type it the same way each time.
            </p>
          </div>
        </Field>

        <Field label="Before you record">
          <ul className={s.tips}>
            {TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Field>

        <Field label="Limits">
          Up to {MAX_SECONDS} seconds and {LENS_MAX_BYTES / (1024 * 1024)} MB. 1080p is plenty.
        </Field>

        <Field label="Film it">
          {sending ? (
            <div className={s.stack}>
              <progress className={s.progress} max={1} value={progress} aria-label="Sending the clip" />
              <p className={s.hint} role="status">
                {progress < 1 ? `Sending the clip… ${Math.round(progress * 100)}%` : "Crux is reading the clip. A long or high-speed video takes a little while."}
              </p>
            </div>
          ) : (
            <div className={s.stack}>
              {/* Two inputs because the camera and the library are different pickers on a phone. */}
              <input ref={record} className="visually-hidden" type="file" accept="video/*" capture="environment" tabIndex={-1} onChange={pick} aria-hidden="true" />
              <input ref={choose} className="visually-hidden" type="file" accept="video/*" tabIndex={-1} onChange={pick} aria-hidden="true" />
              <Button kind="primary" size="l" className={s.wide} disabled={!named} onClick={() => record.current?.click()}>
                Record a clip
              </Button>
              <Button kind="secondary" size="l" className={s.wide} disabled={!named} onClick={() => choose.current?.click()}>
                Choose a video
              </Button>
              {!named && <p className={s.hint}>Name the machine first.</p>}
            </div>
          )}
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
        </Field>
      </Fields>
    </Tag>
  );
}
