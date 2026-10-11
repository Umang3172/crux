// The test-bench bearings: recorded runs to failure, replayed on a plant
// clock. This view only finds the run and loads it; LifeBody draws it. The
// raw files may not be on the server (the public link carries none), in which
// case a synthetic pump life stands in and is labelled as one.

import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { machines } from "../../api/crux";
import type { MachineSummary } from "../../api/types";
import { useDataNote } from "../../app/DataNote";
import type { MachineDef } from "../../demo/stories";
import { useAsync } from "../../lib/hooks";
import { Empty, ErrorState, Loading } from "../../ui/States";
import { LifeBody } from "./LifeBody";
import { loadReplay } from "./replay";

type Choice = { id: string; asked: string | null };

/** The run to show: the one the link names, else the story's, else the first the server holds. */
function choose(list: MachineSummary[], requested: string | null, preferred: string[]): Choice | null {
  const held = new Set(list.map((m) => m.machine));
  const wanted = requested ?? preferred[0] ?? null;
  if (wanted && held.has(wanted)) return { id: wanted, asked: null };
  const id = preferred.find((p) => held.has(p)) ?? list[0]?.machine;
  return id ? { id, asked: wanted } : null;
}

export function LifeView({ def }: { def: MachineDef }) {
  const [params, setParams] = useSearchParams();
  const list = useAsync(() => machines(), []);
  const choice = useMemo(() => (list.data ? choose(list.data.machines, params.get("run"), def.recordings ?? []) : null), [list.data, params, def]);
  const replay = useAsync(() => (choice ? loadReplay(choice.id) : Promise.resolve(null)), [choice?.id]);

  const synthetic = list.data?.synthetic ?? false;
  const note = useMemo(
    () =>
      replay.data
        ? synthetic
          ? "Synthetic pump life from a physics model: this server holds no recorded runs. The plant clock replays it, and the chart shows only what Crux knew by then."
          : `Recorded run: ${replay.data.source}. The plant clock replays it, and the chart shows only what Crux knew by then; the rest stays hidden until you ask.`
        : "The test-bench bearings are recorded runs replayed on a plant clock.",
    [replay.data, synthetic],
  );
  useDataNote(note);

  const retry = () => {
    list.reload();
    replay.reload();
  };
  if (list.error) return <ErrorState error={list.error} onRetry={retry} />;
  if (list.loading || !list.data) return <Loading>Loading the recorded runs…</Loading>;
  if (!choice) {
    return (
      <Empty title="No recorded runs here">
        {list.data.note || "This server holds no recorded bearing runs."}
      </Empty>
    );
  }
  if (replay.error) return <ErrorState error={replay.error} onRetry={retry} />;
  // After a new pick the old recording is still held for a moment; wait for the one chosen.
  if (replay.loading || !replay.data || replay.data.machine !== choice.id) return <Loading>Loading the recording…</Loading>;

  const shown = replay.data;
  const notice = choice.asked ? `The recording this link asks for isn't on this server, so ${shown.name} is shown instead.` : null;
  return (
    <LifeBody
      key={shown.machine}
      name={def.name}
      type={def.type}
      replay={shown}
      list={list.data.machines}
      synthetic={synthetic}
      notice={notice}
      guided={params.get("story") === "bearing-life"}
      onPickRun={(id) => setParams({ run: id }, { replace: true })}
    />
  );
}
