// Which model each AI job is configured with, as the server's /health reports
// it. "Configured", not "answered": the server does not say when a model last
// answered, so nothing here claims one did.

import type { Models } from "../../api/types";
import { AI_JOBS, brainOf, fallbackReason } from "../../lib/ai";
import { Badge, Hint, cx } from "../../ui/kit";

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const LIMIT: Record<string, string> = { rounds: "rounds", model_calls: "model calls", seconds: "s" };

/** The limits the server puts on one investigation, as small chips. */
export function Limits({ limits }: { limits: Record<string, number> }) {
  return (
    <span className="tr-limits">
      {Object.entries(limits).map(([k, v]) => (
        <span key={k} className="tr-limit">
          <b>{v}</b> {LIMIT[k] ?? k.replace(/_/g, " ")}
        </span>
      ))}
    </span>
  );
}

export function AiJobs({ models, raw }: { models: Models; raw?: boolean }) {
  return (
    <ul className="tr-jobs">
      {AI_JOBS.map((j) => {
        const configured = (models as Record<string, string>)[j.key] ?? "";
        const gate = j.key === "gate";
        const b = gate ? { name: "rules in code", live: false } : brainOf(configured);
        const why = fallbackReason(models, j.key);
        return (
          <li key={j.key}>
            <span className="tr-job-name">
              <span className={cx("tr-dot", b.live && "live")} aria-hidden />
              <span className="truncate">{j.label}</span>
              <Hint label={`About the ${j.label.toLowerCase()}`}>{gate || b.live ? j.does : `${j.does} Without a model, ${lower(j.instead)}`}</Hint>
            </span>
            <span className="tr-job-side">
              <Badge tone={b.live ? "ok" : "neutral"} title={configured}>
                {b.name}
              </Badge>
              {raw && configured && <span className="tiny dim mono">{configured}</span>}
            </span>
            {why && <span className="tr-job-why">{why}</span>}
          </li>
        );
      })}
    </ul>
  );
}
