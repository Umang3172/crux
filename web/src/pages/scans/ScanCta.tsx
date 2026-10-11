// How a scan starts: point a phone at a machine and film about ten seconds.
// The tag is blue because it asks for a measurement.

import { ButtonLink } from "../../ui/Button";
import { QrCode } from "../../ui/QrCode";
import { Field, Fields, Tag } from "../../ui/Tag";
import { phoneLensUrl } from "./words";
import s from "./ScanCta.module.css";

export function ScanCta({ machine }: { machine?: string }) {
  const url = phoneLensUrl(machine);
  return (
    <Tag tone="measure" head="Scan" aria-label="Scan a machine">
      <Fields columns={1}>
        <Field label="What to do">
          Film about ten seconds of a machine that has no sensor. Crux measures how its housing shakes from the video.
        </Field>
        <Field label="On a phone">
          <div className={s.qr}>
            <QrCode value={url} size={132} label="QR code that opens the scanner on a phone" />
            <p className={s.url}>{url}</p>
          </div>
        </Field>
        <Field label="On this device">
          <ButtonLink to={machine ? `/phone/lens?machine=${encodeURIComponent(machine)}` : "/phone/lens"} kind="primary">
            Open the scanner
          </ButtonLink>
        </Field>
      </Fields>
    </Tag>
  );
}
