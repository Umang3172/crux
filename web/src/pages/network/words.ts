// Plain words for the update test and for what can go wrong. The server's
// numbers and sentences pass through untouched; only the labels around them
// are ours.

import { ApiError } from "../../api/client";
import type { BundleReport, FleetStatus } from "../../api/types";

export type HistoryEntry = FleetStatus["history"][number];
export type Staged = NonNullable<FleetStatus["staged"]>;
export type Side = NonNullable<BundleReport["current"]>;

// Anything shaped like a file path: absolute, home-relative, dot-relative, or a
// relative path that ends in a file name.
const PATH = /(?:[A-Za-z]:[\\/]|~\/|\.{1,2}\/|\/)[^\s'"`<>|]*[\\/][^\s'"`<>|]*|[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z]\w{0,4}\b/g;

/** A server folder in a message tells a visitor nothing and says where the server keeps its files, so it never reaches the screen. */
export function scrub(text: string): string {
  return text
    .replace(PATH, "")
    .replace(/(['"`])\s*\1/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([:;,.)])/g, "$1")
    .replace(/[:;,]\s*$/, "")
    .trim();
}

/** A share of cases as a whole-number percent. A measured share can really be 0% or 100%, which a belief never is, so this is not `pct`. */
export function share(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  return `${Math.round(x * 100)}%`;
}

/** The forecasters by the name the server gives them, in words a visitor can use. */
export function modelLabel(id: string): { name: string; what: string } {
  if (id === "trend") {
    return { name: "Trend line", what: "Extends the recent growth of the vibration to the danger line. It learns nothing." };
  }
  if (id === "average-life") {
    return { name: "Average life", what: "Ignores the signal and answers from how long earlier bearings lasted." };
  }
  if (id === "gbm-residual") {
    return { name: "Learned model", what: "Learns from failed bearings how far the trend line tends to be wrong, and corrects it." };
  }
  if (id.startsWith("gbm")) {
    return { name: "Learned model", what: "Learns from failed bearings how long is left." };
  }
  return { name: id, what: "" };
}

/** A rolled-back row carries `rollback_of`; an install carries its test report. */
export function rollbackOf(entry: HistoryEntry): number | null {
  const r = entry.report;
  if (r && typeof r === "object" && "rollback_of" in r) {
    const v = (r as { rollback_of: unknown }).rollback_of;
    return typeof v === "number" ? v : null;
  }
  return null;
}

export function reportOf(entry: HistoryEntry): BundleReport | null {
  const r = entry.report;
  return r && typeof r === "object" && "passes" in r ? (r as BundleReport) : null;
}

export type Verdict = "passed" | "failed" | "untested" | "lessons";

/** Failed and untested come from the engine's `passes`; a bundle with no model has nothing to test. */
export function verdictOf(report: BundleReport): Verdict {
  if (report.passes === false) return "failed";
  if (report.passes === null) return "untested";
  return report.current && report.candidate ? "passed" : "lessons";
}

export const VERDICT_WORD: Record<Verdict, string> = {
  passed: "Passed",
  failed: "Failed",
  untested: "Untested",
  lessons: "Lessons only",
};

/** The version of a staged bundle in a pull reply, whose `staged` field the client types as unknown. */
export function versionIn(staged: unknown): number | null {
  if (staged && typeof staged === "object" && "version" in staged) {
    const v = (staged as { version: unknown }).version;
    return typeof v === "number" ? v : null;
  }
  return null;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const KNOWN: Record<string, string> = {
  "nothing staged": "Nothing is staged to install. Check for updates first.",
  "nothing to roll back": "There is nothing to roll back.",
  "the update is worse than the model in use on this site's failures": "This update did not pass its test, so it can't be installed.",
  "a person approves an update: give a name": "Type your name first: only a person installs an update.",
};

/** What went wrong in words a visitor can use. A server error page says nothing useful, so it gets the caller's fallback. */
export function failure(e: unknown, fallback: string): string {
  if (!(e instanceof ApiError)) return fallback;
  if (e.status === 0) return "The engine could not be reached. Try again in a moment.";
  const known = KNOWN[e.detail];
  if (known) return known;
  if (e.status >= 500) return fallback;
  return scrub(e.detail) || fallback;
}
