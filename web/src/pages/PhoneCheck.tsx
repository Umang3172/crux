// The measurement, on a phone. A technician scans the code on the case page
// and lands here: what Crux needs, why, how to take it, one button.

import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { CircleCheck, Cpu, Crosshair } from "lucide-react";
import { getCase } from "../api/crux";
import { useAsync, useCatalogue } from "../lib/hooks";
import { answerWithInstrument, decodeKey, openRequest } from "../lib/instrument";
import { shortId, signed } from "../lib/format";
import { check, fault } from "../lib/plain";
import { PUMP } from "../lib/scenarios";
import { markAnswered } from "../lib/session";
import { Badge, Button, Callout, Card, ErrorState, SkeletonRows, SourceTag } from "../ui/kit";
import "../app/shell.css";
import "./pages.css";

export default function PhoneCheck() {
  const { id = "" } = useParams();
  const [search] = useSearchParams();
  const key = decodeKey(search.get("k") ?? "");
  const got = useAsync(() => getCase(id), [id]);
  const catalogue = useCatalogue();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ value?: number; already: boolean } | null>(null);

  const inv = got.data;
  const req = inv ? openRequest(inv) : null;
  const cat = req ? catalogue.data?.find((t) => t.id === req.test_id) : null;

  async function take() {
    if (!key || !req) return;
    setBusy(true);
    setError(null);
    try {
      const r = await answerWithInstrument(id, key);
      if (!r.already && r.value !== undefined) markAnswered(id, req.test_id, "virtual instrument", "phone", r.value);
      setSent({ value: r.value, already: r.already });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="phone">
      <header className="phone-head">
        <span className="brand-mark" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </span>
        Crux
        <span className="push">
          <Badge>case {shortId(id)}</Badge>
        </span>
      </header>

      {got.error ? (
        <Card>
          <ErrorState error={got.error} onRetry={got.reload} />
        </Card>
      ) : !inv ? (
        <Card>
          <SkeletonRows />
        </Card>
      ) : sent ? (
        <Card tone="ok" title={sent.already ? "Already answered" : "Sent"} icon={<CircleCheck size={16} />}>
          {sent.already ? (
            <p>Someone answered this measurement first. Nothing was sent twice.</p>
          ) : (
            <p>
              The reading <b className="num">{sent.value !== undefined ? signed(sent.value, 2) : ""}</b> is with Crux. It is testing every suspect again; the answer is on the case page.
            </p>
          )}
        </Card>
      ) : !req ? (
        <Card title="Nothing to measure" icon={<CircleCheck size={16} />}>
          <p className="muted">This case is not waiting for a measurement{inv.outcome !== "open" ? ": it has been closed" : ""}.</p>
        </Card>
      ) : (
        <>
          <Card tone="accent" title="Crux needs one measurement" icon={<Crosshair size={16} />}>
            <h3 style={{ fontSize: "1.25rem", lineHeight: 1.25 }}>{check(req.test_id).name}</h3>
            <div className="row row-wrap" style={{ marginTop: 8 }}>
              <Badge>{PUMP.name}</Badge>
              {cat && <Badge>{cat.effort_min} min</Badge>}
              {cat && <Badge>{cat.downtime === "none" ? "machine keeps running" : cat.downtime}</Badge>}
            </div>
            <p className="muted" style={{ marginTop: 12 }}>
              Crux cannot tell {req.separates.map((k) => `“${fault(k).name}”`).join(" from ")}. This reading separates them.
            </p>
          </Card>

          {cat && (
            <Card title="How to take it">
              <ol className="steps">
                {cat.procedure.map((p) => (
                  <li key={p}>
                    <span>{p}</span>
                  </li>
                ))}
              </ol>
              <p className="small dim" style={{ marginTop: 12 }}>
                Isolate and lock out under your site's own procedure before touching anything that moves.
              </p>
            </Card>
          )}

          <Card>
            <div className="col gap-3">
              <Button variant="primary" size="lg" block icon={<Cpu size={16} />} busy={busy} disabled={!key} onClick={take}>
                Take the reading
              </Button>
              <div className="row row-wrap">
                <SourceTag source="physics model · synthetic" />
              </div>
              <span className="small dim">
                {key
                  ? "This pump is a physics model. Its own instrument takes the reading: a new simulated capture of the same pump in the same state. It answers from the fault it was given."
                  : "This link carries no key for the pump model's instrument, so the reading cannot be taken from here. Open it from the code on the case page."}
              </span>
              {error && <Callout tone="danger">{error}</Callout>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
