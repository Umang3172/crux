// The bench motor. Its signal arrives from a real sensor, and only the laptop
// server hears it while it sends, so this page says what the server holds
// right now and nothing more: no waveform or controls that would need the
// sensor's token in a web page.

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { streamStatus } from "../../api/crux";
import type { StreamStatus } from "../../api/types";
import { useDataNote } from "../../app/DataNote";
import type { MachineDef } from "../../demo/stories";
import { num } from "../../lib/format";
import { ButtonLink } from "../../ui/Button";
import { ErrorState, Loading } from "../../ui/States";
import { SourceTag } from "../../ui/SourceTag";
import { Field, Fields, Tag } from "../../ui/Tag";
import { MachineHead } from "./MachineHead";
import s from "./LiveView.module.css";

const EVERY_MS = 3000;
const NOTE = "The bench motor is read live from its sensor (2 kHz), on the laptop server only, while the sensor is sending.";

export function LiveView({ def }: { def: MachineDef }) {
  const sensor = def.sensor ?? "rig-01";
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useDataNote(NOTE);

  const read = useCallback(async () => {
    try {
      setStatus(await streamStatus(sensor));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error("The sensor status could not be read."));
    }
  }, [sensor]);

  useEffect(() => {
    void read();
    const timer = window.setInterval(read, EVERY_MS);
    return () => window.clearInterval(timer);
  }, [read]);

  const unreachable = error instanceof ApiError && error.status === 0;
  const sending = !!status && status.seconds > 0;

  return (
    <div className={s.page}>
      <MachineHead name={def.name} type={def.type}>
        <SourceTag>{def.source}</SourceTag>
      </MachineHead>
      {error && !status ? (
        <ErrorState error={error} onRetry={read} title={unreachable ? undefined : "The sensor status could not be read"} />
      ) : !status ? (
        <Loading>Asking the server what the sensor is sending…</Loading>
      ) : (
        <div className={s.body}>
          <Tag tone={sending ? "stock" : "void"} head={sending ? "Live" : "Not sending"} aria-label="The bench sensor" aria-live="polite">
            <Fields columns={2}>
              <Field label="Now" wide>
                {sending
                  ? "The bench sensor is sending. This is what the server holds of its signal right now."
                  : "The server has no signal from the bench sensor right now. It shows here once the sensor starts sending."}
              </Field>
              <Field label="Signal on hand">
                <span className={s.value}>{num(status.seconds, 0)}</span> seconds
              </Field>
              <Field label="Sample rate">
                <span className={s.value}>{num(status.sample_rate_hz, 0)}</span> a second
              </Field>
              <Field label="Marked as its normal">
                <span className={s.value}>{status.normal_captures}</span> {status.normal_captures === 1 ? "capture" : "captures"}
              </Field>
              <Field label="Source">
                <SourceTag>live sensor · 2 kHz</SourceTag>
              </Field>
            </Fields>
          </Tag>
          <p className={s.words}>The live view runs on the laptop server while the bench sensor is sending. Nothing here sends a command to the motor.</p>
          <ButtonLink to="/">Back to the plant</ButtonLink>
        </div>
      )}
    </div>
  );
}
