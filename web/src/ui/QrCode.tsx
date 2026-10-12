// A QR code drawn as one SVG path, so it stays sharp at any size. Always dark
// on white, whatever the theme: a phone camera needs the contrast.

import QR from "qrcode";
import { useMemo } from "react";

export function QrCode({ value, size = 132, label }: { value: string; size?: number; label: string }) {
  const { path, n } = useMemo(() => {
    const qr = QR.create(value, { errorCorrectionLevel: "M" });
    const count = qr.modules.size;
    let d = "";
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        if (qr.modules.get(x, y)) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    return { path: d, n: count };
  }, [value]);
  const quiet = 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${n + quiet * 2} ${n + quiet * 2}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect x={-quiet} y={-quiet} width={n + quiet * 2} height={n + quiet * 2} fill="#ffffff" />
      <path d={path} fill="#0a0c11" />
    </svg>
  );
}

/** The link a phone opens for a case's check. The key carries the run settings the pump model answers from. */
export function phoneCheckUrl(caseId: string, key: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/phone/check/${encodeURIComponent(caseId)}?k=${key}`;
}
