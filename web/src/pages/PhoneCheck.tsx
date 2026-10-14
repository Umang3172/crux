// The measurement, on a phone. A technician scans the code on the
// investigation's page and lands here: what to measure, how, one button.

import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { CircleCheck, Cpu, Info } from "lucide-react";
import { getCase } from "../api/crux";
import { useAsync, useCatalogue } from "../lib/hooks";
import { answerWithInstrument, decodeKey, openRequest } from "../lib/instrument";
import { list, shortId, signed } from "../lib/format";
import { check, fault } from "../lib/plain";
import { machineById } from "../lib/plant";
import { markAnswered } from "../lib/session";
import { Badge, Button, Callout, ErrorState, SkeletonRows } from "../ui/kit";
import "../app/shell.css";
import "../styles/app.css";
import "./pages.css";

export default function PhoneCheck() {
  const { id = "" } = useParams();
  const [search] = useSearchParams();
  const key = decodeKey(search.get("k") ?? "");
  const machine = machineById(search.get("m") ?? undefined);
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
        <span className="mn-mark" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M2 2l8 8M10 2L2 10" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
        Crux
        <span className="push mono dim small">{shortId(id)}</span>
      </header>

      {got.error ? (
        <ErrorState error={got.error} onRetry={got.reload} />
      ) : !inv ? (
        <SkeletonRows />
      ) : sent ? (
        <section className="ph-done" role="status">
          {sent.already ? (
            <Info size={44} className="dim" aria-hidden />
          ) : (
            <svg className="ph-tick" viewBox="0 0 52 52" aria-hidden>
              <circle cx="26" cy="26" r="24" />
              <path d="M15 27l7 7 15-16" />
            </svg>
          )}
          <h1>{sent.already ? "Already answered" : "Sent"}</h1>
          {sent.already ? (
            <p className="muted">Someone answered first. Nothing was sent twice.</p>
          ) : (
            <p className="muted">
              Reading <b className="num">{sent.value !== undefined ? signed(sent.value, 2) : ""}</b>. Crux is testing every suspect again; the result is on the investigation.
            </p>
          )}
        </section>
      ) : !req ? (
        <section className="ph-done">
          <CircleCheck size={44} className="dim" aria-hidden />
          <h1>Nothing to measure</h1>
          <p className="muted">{inv.outcome !== "open" ? "This investigation is closed." : "This investigation is not waiting for a measurement."}</p>
        </section>
      ) : (
        <>
          <section className="ph-job">
            <span className="eyebrow">Measurement needed</span>
            <h1>{check(req.test_id).name}</h1>
            {machine && <p className="ph-machine">{machine.name}</p>}
            {cat && (
              <div className="row row-wrap">
                <Badge>{cat.effort_min} min</Badge>
                <Badge>{cat.downtime === "none" ? "Machine keeps running" : cat.downtime}</Badge>
              </div>
            )}
            <p className="muted">Decides between {list(req.separates.map((k) => `“${fault(k).name}”`))}.</p>
          </section>

          {cat && (
            <section className="ph-steps">
              <h2>How to take it</h2>
              <ol className="steps">
                {cat.procedure.map((p) => (
                  <li key={p}>
                    <span>{p}</span>
                  </li>
                ))}
              </ol>
              <p className="small dim">Lock out under your site's procedure before touching anything that moves.</p>
            </section>
          )}

          <div className="ph-action">
            {error && <Callout tone="danger">{error}</Callout>}
            <Button variant="primary" size="lg" block icon={<Cpu size={18} />} busy={busy} disabled={!key} onClick={take}>
              Take the reading
            </Button>
            <p className="small dim">
              {key
                ? "Synthetic: the model's own instrument takes the reading, and answers from the fault it was given."
                : "This link has no key for the model's instrument. Scan the code on the investigation's page."}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
