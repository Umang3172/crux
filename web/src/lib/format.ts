// One rule for every number on screen.

/** Beliefs and chances: whole numbers, never 0% or 100%, which nothing measured can be. */
export function pct(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  if (x >= 0.995) return ">99%";
  if (x < 0.005) return "<1%";
  return `${Math.round(x * 100)}%`;
}

export function num(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  return x.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Signed values (the envelope reading is negative for an inner-ring fault). */
export function signed(x: number, digits = 2): string {
  const s = Math.abs(x).toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return x < 0 ? `−${s}` : s;
}

export const rpm = (x: number) => `${Math.round(x).toLocaleString("en-GB")} rpm`;
export const times = (x: number) => `${num(x, 1)}×`;
export const minutes = (m: number) => `${m} min`;

export function hours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${num(h, h < 10 ? 1 : 0)} h`;
}

export function clock(t: number): string {
  return new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function stamp(t: number | string): string {
  const d = typeof t === "string" ? new Date(t) : new Date(t);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "a, b and c" */
export function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Case ids are long; people read the last four characters. */
export const shortId = (id: string) => id.replace(/^inv_/, "").slice(-4).toUpperCase();
