import { lazy, Suspense } from "react";
import { useParams } from "react-router";
import { caseEntry, useWorld } from "../demo/world";
import { Loading } from "../ui/States";
import { EngineCase } from "./case/EngineCase";

const AiCase = lazy(() => import("./case/AiCase"));

// One case page for every source: engine cases and AI-investigator runs read
// differently on the server, so each has its own view under the same route.
export default function Case() {
  const { id } = useParams();
  const world = useWorld();
  if (!id) return null;
  const entry = caseEntry(world, id);
  if (entry?.kind === "ai") {
    return (
      <Suspense fallback={<Loading />}>
        <AiCase caseId={id} />
      </Suspense>
    );
  }
  return <EngineCase key={id} caseId={id} entry={entry} />;
}
