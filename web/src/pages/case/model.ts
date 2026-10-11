// What the case page reads off an engine case, in one place.

import type { Capture, Investigation, LedgerEntry, TestRequest } from "../../api/types";
import type { Snapshot } from "../../demo/world";
import { openRequest } from "../../demo/instrument";

export type Readings = {
  /** Vibration as a multiple of the quiet-room normal (/capture). */
  level: number | null;
  temperatureC: number | null;
  /** Speed measured from the signal (ledger), not the reported speed. */
  rpm: number | null;
  noisyFloor: boolean;
};

export function readings(inv: Investigation | null, cap: Capture | null, noise: number | undefined): Readings {
  const speed = inv?.ledger.find((e) => /measured from the 1x peak/.test(e.statement));
  return {
    level: cap && cap.baseline_rms > 0 ? cap.rms / cap.baseline_rms : null,
    temperatureC: cap?.temperature_c ?? numberOf(inv?.ledger.find((e) => /housing temperature/.test(e.statement))),
    rpm: numberOf(speed) ?? inv?.rpm ?? null,
    noisyFloor: (noise ?? 0) >= 0.3,
  };
}

function numberOf(e: LedgerEntry | undefined): number | null {
  if (!e) return null;
  const v = typeof e.value === "number" ? e.value : Number(e.value);
  return Number.isFinite(v) ? v : null;
}

/** "104 simulated captures across 13 predicted lines", from the engine's own transcript. */
export function experimentCount(inv: Investigation): { captures: number; lines: number } | null {
  for (const t of inv.transcript) {
    const m = /(\d+) simulated captures across (\d+) predicted lines/.exec(t);
    if (m) return { captures: Number(m[1]), lines: Number(m[2]) };
  }
  return null;
}

/** The beliefs as they stood at reading k, falling back to the live case. */
export function beliefsAt(inv: Investigation, snaps: Record<number, Snapshot> | undefined, k: number): Snapshot["beliefs"] {
  const s = snaps?.[k];
  if (s) return s.beliefs;
  return inv.hypotheses.map((h) => ({ kind: h.kind, label: h.label, origin: h.origin, posterior: h.posterior, rejected: h.rejected }));
}

/** The request Crux made after reading k, if any. */
export function requestAt(inv: Investigation, snaps: Record<number, Snapshot> | undefined, k: number): TestRequest | null {
  const s = snaps?.[k];
  if (s) return s.request && inv.requested_tests.length > k ? s.request : null;
  if (k === inv.outcomes.length) return openRequest(inv);
  return null;
}

/** The order tags hang in: strongest first after the experiments, then fixed. */
export function rackOrder(inv: Investigation, snaps: Record<number, Snapshot> | undefined): string[] {
  const first = beliefsAt(inv, snaps, 0);
  return [...first].sort((a, b) => b.posterior - a.posterior).map((b) => b.kind);
}

export const CATALOGUE_FAULTS = ["healthy", "imbalance", "misalignment", "looseness", "outer_race", "inner_race"];

export const isCatalogue = (fault: string) => CATALOGUE_FAULTS.includes(fault);

export function ledgerById(inv: Investigation): Map<string, LedgerEntry> {
  return new Map(inv.ledger.map((e) => [e.id, e]));
}

/** The engine words the change-of-mind sentence by its feature; a temperature one rests on an unmeasured table. */
export const restsOnTemperatureTable = (sentence: string) => /temp_rise_c|temperature/.test(sentence);
