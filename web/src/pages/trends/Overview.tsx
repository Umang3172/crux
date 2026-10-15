// The first screen: what happened at this moment in plain words, and what
// changed against a normal week. For a bearing, where its time left lives.

import { ArrowRight } from "lucide-react";
import type { BenchView, ChangesView, Preset, Source, SummaryView } from "../../api/series.types";
import type { Async } from "../../lib/hooks";
import { LinkButton } from "../../ui/kit";
import { Changes } from "./Changes";
import { MadeLine, isGoogle } from "./Made";
import { Slot } from "./slot";
import { Trust } from "./Trust";

function Words({ view, caveat }: { view: SummaryView; caveat?: string | null }) {
  const gemini = view.writer.startsWith("gemini");
  return (
    <>
      <div className="tn-summary">
        {view.sentences.map((s, i) => (
          <p key={i} className={i === 0 ? "tn-lede" : undefined}>
            {s}
          </p>
        ))}
      </div>
      {caveat && <p className="tn-note tn-caveat">{caveat}</p>}
      <MadeLine
        made={view.made}
        what={`${gemini ? "Written by Gemini" : "Written from a template"} from numbers ${isGoogle(view.made) ? "Google's models computed in BigQuery" : "the stand-in computed"}. A sentence with any other number is dropped.`}
        extra={
          <div className="col gap-2">
            <div className="label">The facts it was given</div>
            <ul className="tn-facts">
              {view.facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <p className="muted small">Writer: {view.writer}</p>
          </div>
        }
      />
    </>
  );
}

export function Overview({
  source,
  preset,
  summary,
  changes,
  bench,
}: {
  source: Source;
  preset: Preset | undefined;
  summary: Async<SummaryView>;
  changes: Async<ChangesView>;
  bench?: BenchView | null;
}) {
  const bearing = source.kind === "bearing";
  return (
    <>
    <div className="tn-overview">
      <section className="tn-panel tn-words" aria-labelledby="tn-words-h">
        <h2 id="tn-words-h" className="tn-h">
          In plain words
        </h2>
        <Slot a={summary} rows={3}>
          {(v) => <Words view={v} caveat={!bearing && preset?.id !== "normal" ? source.note : null} />}
        </Slot>
      </section>

      <section className="tn-panel tn-changed" aria-labelledby="tn-changed-h">
        {bearing ? (
          <>
            <h2 id="tn-changed-h" className="tn-h">
              Time left
            </h2>
            <p className="tn-note">{source.note}</p>
            {preset?.machine && (
              <LinkButton to={`/lives/${preset.machine}`} icon={<ArrowRight size={14} />} variant="primary" size="sm">
                Open this run's machine page
              </LinkButton>
            )}
          </>
        ) : (
          <>
            <h2 id="tn-changed-h" className="tn-h">
              What changed against a normal week
            </h2>
            {preset?.id === "normal" ? (
              <p className="tn-note">This is the normal week. Pick a leak to see what changed against it.</p>
            ) : (
              <Slot a={changes} rows={4}>
                {(v) => <Changes view={v} />}
              </Slot>
            )}
          </>
        )}
      </section>
    </div>
    {!bearing && <Trust bench={bench} what="detector" />}
    </>
  );
}
