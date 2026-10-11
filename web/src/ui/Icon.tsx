// One small icon set, drawn in a single 1.75px stroke on a 20px grid, so
// every glyph on screen belongs to the same hand.

type Name =
  | "check"
  | "circle"
  | "dot"
  | "phone"
  | "qr"
  | "arrow-right"
  | "arrow-down"
  | "chevron-down"
  | "close"
  | "clock"
  | "running"
  | "stop"
  | "play"
  | "pause"
  | "hazard"
  | "external"
  | "note"
  | "refresh";

const PATHS: Record<Name, string> = {
  check: "M4.5 10.5l3.5 3.5 7.5-8",
  circle: "M10 3.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13z",
  dot: "M10 7.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5z",
  phone: "M7 2.5h6a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM9 15h2",
  qr: "M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h2v2h-2zM14.5 14.5h2v2h-2zM14.5 11.5h2M11.5 16.5h2",
  "arrow-right": "M4 10h12M11 5l5 5-5 5",
  "arrow-down": "M10 4v12M5 11l5 5 5-5",
  "chevron-down": "M5.5 8l4.5 4.5L14.5 8",
  close: "M5 5l10 10M15 5L5 15",
  clock: "M10 3.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13zM10 6.5V10l2.5 1.5",
  running: "M3.5 10a6.5 6.5 0 0 1 11.1-4.6M16.5 10a6.5 6.5 0 0 1-11.1 4.6M14.6 2.5v2.9h-2.9M5.4 17.5v-2.9h2.9",
  stop: "M5.5 5.5h9v9h-9z",
  play: "M6.5 4.5l9 5.5-9 5.5z",
  pause: "M6.5 4.5v11M13.5 4.5v11",
  hazard: "M10 3L17.5 16H2.5zM10 8v4M10 14v.5",
  external: "M8 4.5H4.5v11h11V12M11 3.5h5.5V9M16.5 3.5L9 11",
  note: "M4.5 3.5h8l3 3v10h-11zM7 9h6M7 12h6",
  refresh: "M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3.5h-3.5",
};

export function Icon({ name, size = 18, title }: { name: Name; size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
