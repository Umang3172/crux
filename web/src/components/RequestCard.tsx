/**
 * The moment the agent stops computing and asks a person for something.
 *
 * This is the part of the product that is not a classifier, so it gets a card of
 * its own: what it wants, *why* it wants that one rather than any other, what it
 * will cost in technician-minutes, and whether the machine has to stop. The
 * reason is the engine's own sentence from the transcript, not a UI paraphrase.
 */

import { EvidenceTest, Investigation } from "../api";

const REQUEST_PREFIX = "requested measurement:";

/** Expected information gain, in nats, as the engine wrote it to the ledger. */
function natsFor(inv: Investigation, index: number): number | null {
  const requests = inv.ledger.filter((e) =>
    e.statement.toLowerCase().startsWith(REQUEST_PREFIX),
  );
  const value = requests[index]?.value;
  return typeof value === "number" ? value : null;
}

/** "Cannot separate X vs Y. Requesting: … (separates the survivors by N sigma…)" */
function reasonFor(inv: Investigation, index: number): string | null {
  return inv.transcript.filter((line) => line.includes("Requesting:"))[index] ?? null;
}

export function RequestCard({
  inv,
  index,
  answered,
  tests,
}: {
  inv: Investigation;
  index: number;
  answered: boolean;
  tests: EvidenceTest[];
}) {
  const testId = inv.requested_tests[index];
  if (!testId) return null;

  const test = tests.find((t) => t.id === testId);
  const nats = natsFor(inv, index);
  const reason = reasonFor(inv, index);
  const outcome = answered ? inv.outcomes[index] : undefined;

  return (
    <section className="request">
      <header>
        <h2>{answered ? "Measurement returned" : "Measurement requested"}</h2>
      </header>
      <p className="request-name">{test?.name ?? testId}</p>
      {reason && <p className="request-why">{reason}</p>}

      <div className="costs">
        {outcome ? (
          <div className="cost gain">
            <div className="k">{outcome.feature}</div>
            <div className="v">{outcome.value.toFixed(3)}</div>
          </div>
        ) : (
          nats !== null && (
            <div className="cost gain">
              <div className="k">expected gain</div>
              <div className="v">{nats.toFixed(2)} nats</div>
            </div>
          )
        )}
        {test && (
          <>
            <div className="cost">
              <div className="k">technician time</div>
              <div className="v">{test.effort_min.toFixed(0)} min</div>
            </div>
            <div className="cost">
              <div className="k">downtime</div>
              <div className="v">{test.downtime}</div>
            </div>
            <div className="cost">
              <div className="k">{outcome ? "expected gain" : "returns"}</div>
              <div className="v" style={{ fontFamily: "var(--mono)", fontSize: 13 }}>
                {outcome ? `${nats?.toFixed(2) ?? "—"} nats` : test.feature}
              </div>
            </div>
          </>
        )}
      </div>

      {test && !answered && (
        <>
          <ol className="procedure">
            {test.procedure.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          {test.coach_prompt && <p className="coach">“{test.coach_prompt}”</p>}
        </>
      )}
    </section>
  );
}
