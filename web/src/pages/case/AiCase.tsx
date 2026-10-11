// An AI investigator's case, told on one page: the machine with the cause the
// engine named hung on it, the answer in the engine's words, the suspects, and
// then the AI's work as a conversation where its words and the physics' answers
// look different. The server returns an AI run once and keeps none, so the run
// is read from this browser's record.

import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../../api/client";
import { report } from "../../api/crux";
import type { AgentRun, CaseView, Note, Report } from "../../api/types";
import { useDataNote } from "../../app/DataNote";
import { machineDef } from "../../demo/stories";
import { caseEntry, raiseHazard, saveRun, useWorld, type CaseEntry } from "../../demo/world";
import { useAsync } from "../../lib/hooks";
import { Button } from "../../ui/Button";
import { Empty } from "../../ui/States";
import { AiAnswer } from "./ai/AiAnswer";
import { AiHead } from "./ai/AiHead";
import { AiNotes } from "./ai/AiNotes";
import { AiScene } from "./ai/AiScene";
import { AiSuspects } from "./ai/AiSuspects";
import { brainOfTurn, proposalsOf, turnsOf } from "./ai/derive";
import { Missing } from "./ai/Missing";
import { Reveal } from "./ai/Reveal";
import { useRerun } from "./ai/useRerun";
import { Work } from "./ai/Work";
import s from "./ai/AiCase.module.css";

const DATA_NOTE =
  "An AI investigator's run, returned once by the engine and kept in this browser. The pump is a physics model, so its readings are synthetic. Every belief comes from simulated likelihoods; the AI's words carry its name.";

export default function AiCase({ caseId }: { caseId: string }) {
  const world = useWorld();
  const entry = caseEntry(world, caseId);
  const stored = world.runs[caseId];
  if (!stored) return <Missing entry={entry} />;
  const { run, note } = stored;
  if (!run.case) return <NoCase run={run} />;
  return <Loaded caseId={caseId} entry={entry} run={run} c={run.case} note={note} />;
}

/** A run that never opened a case: say why, in the server's words. */
function NoCase({ run }: { run: AgentRun }) {
  return (
    <Empty title="The investigator did not open a case">
      <p>{run.stopped ?? run.fallback ?? "The run ended before a case was opened."}</p>
    </Empty>
  );
}

function Loaded({
  caseId,
  entry,
  run,
  c,
  note,
}: {
  caseId: string;
  entry: CaseEntry | undefined;
  run: AgentRun;
  c: CaseView;
  note: string;
}) {
  useDataNote(DATA_NOTE);
  const turns = useMemo(() => turnsOf(run), [run]);
  const proposals = useMemo(() => proposalsOf(turns, c), [turns, c]);
  const scripted = turns.every((t) => !brainOfTurn(t).live);
  const machineId = entry?.machine ?? "p2";
  const machine = machineDef(machineId);
  const [lost, setLost] = useState(false);
  const rerun = useRerun(entry);

  // The engine's own lines for the answer. `engine` asks for no model, so
  // nothing here can carry a model's words.
  const closed = c.status !== "open";
  const rep = useAsync(() => (closed ? report(caseId, "engine") : Promise.resolve<Report | null>(null)), [caseId, closed]);
  const gone = lost || (rep.error instanceof ApiError && rep.error.status === 404);

  // A hazard in a note the run was given raises the banner here too.
  useEffect(() => {
    const flagged = c.notes.find((n) => n.hazards.length > 0);
    if (c.hazard && flagged) raiseHazard({ caseId, machine: machineId, text: flagged.text });
  }, [c.hazard, c.notes, caseId, machineId]);

  // Notes are kept with the stored run, so they are still here after a refresh.
  const saveNotes = (notes: Note[], hazard: string | null) => saveRun(caseId, { ...run, case: { ...c, notes, hazard } }, note);

  return (
    <div className={s.page}>
      <AiHead
        caseId={caseId}
        machineName={machine?.name ?? "Cooling-water pump P-2"}
        run={run}
        c={c}
        written={proposals.length}
        scripted={scripted}
      />
      {gone && (
        <div className={s.lost} role="alert">
          <p>
            <b>This case was kept in the server's memory and the server restarted. Start it again.</b> The run below is kept in this
            browser, but new notes and the engine's written action need the case on the server.
          </p>
          {entry && (
            <Button onClick={rerun.run} busy={rerun.busy} disabled={rerun.busy}>
              {rerun.busy ? "Running it again…" : "Run it again"}
            </Button>
          )}
          {rerun.error && <p className={s.error}>{rerun.error}</p>}
        </div>
      )}
      <div className={s.grid}>
        <AiScene c={c} />
        <AiAnswer c={c} run={run} turns={turns} rep={rep.data} />
      </div>
      <AiSuspects c={c} proposals={proposals} />
      <Work run={run} c={c} turns={turns} proposals={proposals} scripted={scripted} />
      <AiNotes caseId={caseId} machine={machineId} notes={c.notes} hazard={c.hazard} onSaved={saveNotes} onLost={() => setLost(true)} />
      <Reveal entry={entry} run={run} c={c} />
    </div>
  );
}
