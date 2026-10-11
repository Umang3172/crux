// The check on a phone: the QR code on the case page lands here. The link
// carries a key with the run's settings, which the pump model's virtual
// instrument answers from; nobody ever sees the settings, only the reading.

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { ApiError } from "../../api/client";
import { decodeKey, type InstrumentParams } from "../../demo/instrument";
import { raiseHazard } from "../../demo/world";
import { useCase, useCatalogue } from "../../lib/hooks";
import { CaseLost, Empty, ErrorState, Loading } from "../../ui/States";
import { Floor, PUMP } from "./check/Floor";
import { useTakeReading, useWaking } from "./check/useTakeReading";

export default function PhoneCheck() {
  const { caseId = "" } = useParams();
  const [search] = useSearchParams();
  const k = search.get("k");
  const params = useMemo(() => (k ? decodeKey(k) : null), [k]);

  if (!params || !caseId) {
    return (
      <Empty title="This link only works from the QR code">
        <p>
          The reading is taken with a key that only the QR code carries. Open the case on the laptop and scan the code it
          shows.
        </p>
      </Empty>
    );
  }
  return <Flow caseId={caseId} params={params} />;
}

function Flow({ caseId, params }: { caseId: string; params: InstrumentParams }) {
  // Read the case every 1.5 s while it is open: another screen may answer first.
  const [poll, setPoll] = useState(true);
  const { inv, setInv, error, reload } = useCase(caseId, poll);
  const catalogue = useCatalogue();
  const waking = useWaking();
  const { phase, take, next } = useTakeReading(caseId, params, inv, setInv);

  useEffect(() => setPoll(!inv || inv.outcome === "open"), [inv]);

  // A hazard on the case overrides everything here too, until a person acknowledges it.
  const hazard = inv?.hazard ?? null;
  useEffect(() => {
    if (hazard) raiseHazard({ caseId, machine: PUMP, text: hazard });
  }, [hazard, caseId]);

  if (error instanceof ApiError && error.status === 404) return <CaseLost />;
  if (!inv) {
    return error ? (
      <ErrorState error={error} onRetry={reload} />
    ) : (
      <Loading>{waking ? "Waking the engine… the first request after a quiet spell takes a few seconds." : "Reading the case…"}</Loading>
    );
  }
  if (catalogue.error) return <ErrorState error={catalogue.error} onRetry={catalogue.reload} />;
  if (!catalogue.data) return <Loading>Loading the check…</Loading>;

  return <Floor caseId={caseId} inv={inv} tests={catalogue.data} phase={phase} take={take} next={next} offline={error !== null} />;
}
