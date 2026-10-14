// How a view was made: one line naming the Google product under each screen,
// and a dialog with the model, the settings, the cost and the exact SQL that ran.

import { useState, type ReactNode } from "react";
import { Cloud, CloudOff, Code2 } from "lucide-react";
import type { Made } from "../../api/series.types";
import { Badge, Button, Dialog } from "../../ui/kit";

export const isGoogle = (m: Pick<Made, "engine">) => m.engine === "bigquery";

/** Which engine made a view: Google, or the offline stand-in, said plainly. */
export function EngineBadge({ made }: { made: Pick<Made, "engine" | "product"> }) {
  return isGoogle(made) ? (
    <Badge tone="ok" title={made.product}>
      <Cloud size={12} aria-hidden />
      Google BigQuery
    </Badge>
  ) : (
    <Badge tone="warn" title="Computed by a simple rule on this server, not by Google">
      <CloudOff size={12} aria-hidden />
      Offline stand-in, not Google
    </Badge>
  );
}

const money = (usd?: number) => (usd === undefined ? null : usd < 0.01 ? "under $0.01" : `$${usd.toFixed(2)}`);
const mb = (b?: number) => (b === undefined ? null : `${(b / 1e6).toFixed(1)} MB`);

function value(v: unknown): string {
  if (v === null || v === undefined) return "–";
  if (Array.isArray(v)) return v.map(value).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** The line under a screen: what made it, and the door to the details. */
export function MadeLine({ made, what, extra }: { made: Made; what: ReactNode; extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const when = new Date(made.computed_at);
  const settings = Object.entries(made.settings ?? {}).filter(([k]) => k !== "chosen");
  return (
    <div className="tn-made">
      <span className="tn-made-what">{what}</span>
      <Button size="sm" variant="ghost" icon={<Code2 size={13} />} onClick={() => setOpen(true)}>
        How this was made
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="How this was made" sub={`${made.model} · ${made.product}`} wide>
        <div className="col gap-4">
          <dl className="defs tn-defs">
            <dt>Engine</dt>
            <dd>
              <EngineBadge made={made} />
            </dd>
            {settings.map(([k, v]) => (
              <div key={k} className="contents">
                <dt>{k.replace(/_/g, " ")}</dt>
                <dd className="mono small">{value(v)}</dd>
              </div>
            ))}
            {made.cost?.billed_bytes !== undefined && (
              <>
                <dt>Billed</dt>
                <dd>
                  {mb(made.cost.billed_bytes)}, {money(made.cost.usd)}
                </dd>
              </>
            )}
            <dt>Computed</dt>
            <dd>{Number.isNaN(when.getTime()) ? made.computed_at : when.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</dd>
          </dl>
          {extra}
          {made.sql ? (
            <div className="col gap-2">
              <div className="label">The exact SQL that ran</div>
              <pre className="code-block tn-sql">{made.sql}</pre>
            </div>
          ) : (
            <p className="muted small">No SQL: the stand-in rule on this server computed it.</p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
