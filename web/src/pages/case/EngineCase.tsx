// The hero page: one engine investigation told from the reading to the
// answer, one stage on screen at a time. The evidence and the log open in
// place. Everything shown is the engine's state or a snapshot of it taken in
// this browser as the readings arrived.

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { ApiError } from "../../api/client";
import { capture } from "../../api/crux";
import type { FaultKind } from "../../api/types";
import { useDataNote } from "../../app/DataNote";
import { answerWithInstrument, openRequest, type InstrumentParams } from "../../demo/instrument";
import { machineDef } from "../../demo/stories";
import { getWorld, markAnswered, raiseHazard, recordSnapshot, type CaseEntry } from "../../demo/world";
import { forkOf, reachedStage, STAGES, stageIndex, type StageId } from "../../lib/case";
import { useAsync, useCase, useReducedMotion } from "../../lib/hooks";
import { fault } from "../../lib/plain";
import { MachineScene, patternFor } from "../../ui/machine/MachineScene";
import { PumpDrawing } from "../../ui/machine/PumpDrawing";
import { StageLine } from "../../ui/StageLine";
import { CaseLost, ErrorState, Loading } from "../../ui/States";
import { CaseHeader } from "./CaseHeader";
import { EvidenceLog } from "./EvidenceLog";
import { MeasureTag, VerdictTag } from "./CaseTags";
import { isCatalogue, readings } from "./model";
import { StageAnswer } from "./StageAnswer";
import { StageCheck } from "./StageCheck";
import { StageExperiments } from "./StageExperiments";
import { StageReading } from "./StageReading";
import { StageSuspects } from "./StageSuspects";
import s from "./Case.module.css";

const TAG_WIDTH = 360;

export function EngineCase({ caseId, entry }: { caseId: string; entry: CaseEntry | undefined }) {
  const reduce = useReducedMotion();
  const [search, setSearch] = useSearchParams();
  const [poll, setPoll] = useState(false);
  const { inv, setInv, error } = useCase(caseId, poll);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState(search.get("open") === "evidence");
  const [log, setLog] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0.5, y: 0.5 });
  const [firstStage, setFirstStage] = useState<StageId | null>(null);
  const seen = useRef<number | null>(null);

  const params = entry?.params;
  const cap = useAsync(
    () => (params && isCatalogue(params.fault) ? capture({ ...params, fault: params.fault as FaultKind }) : Promise.resolve(null)),
    [caseId],
  );
  const read = readings(inv, cap.data, params?.extra_noise);
  const machine = machineDef(entry?.machine ?? "p2");
  useDataNote(
    "The pump is a physics model: its readings are synthetic, made by the engine from the fault it was given. Beliefs move only through simulated likelihoods and measured evidence.",
  );

  const open = inv ? openRequest(inv) : null;
  useEffect(() => setPoll(!!open), [open]);

  // Keep a snapshot per reading, raise a reported hazard, and notice a
  // reading that arrived from somewhere else (the phone).
  useEffect(() => {
    if (!inv) return;
    recordSnapshot(inv);
    if (inv.hazard) raiseHazard({ caseId, machine: entry?.machine ?? "p2", text: inv.hazard });
    const n = inv.outcomes.length;
    if (seen.current !== null && n > seen.current) {
      const last = inv.outcomes[n - 1];
      const mine = getWorld().cases.find((c) => c.id === caseId);
      if (mine && !mine.answered[last.test_id]) markAnswered(caseId, last.test_id, "virtual instrument", "phone");
      setSearch((p) => {
        p.set("stage", "check");
        return p;
      });
    }
    seen.current = n;
    if (firstStage === null) {
      const fresh = !!entry && Date.now() - entry.createdAt < 20_000 && n === 0;
      setFirstStage(fresh ? "reading" : reachedStage(inv));
    }
  }, [inv, caseId, entry, firstStage, setSearch]);

  const reached = inv ? reachedStage(inv) : "reading";
  const stage = ((search.get("stage") as StageId | null) ?? firstStage ?? reached) as StageId;
  const shown = stageIndex(stage) > stageIndex(reached) ? reached : stage;

  const go = (id: StageId) =>
    setSearch((p) => {
      p.set("stage", id);
      return p;
    });

  async function doItHere() {
    if (!params || !open) return;
    setBusy(true);
    setActionError(null);
    try {
      const r = await answerWithInstrument(caseId, params as InstrumentParams);
      if (!r.already) markAnswered(caseId, open.test_id, "virtual instrument", "here");
      setInv(r.inv);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "The reading could not be taken.");
    } finally {
      setBusy(false);
    }
  }

  const verdict = inv?.outcome === "concluded" ? inv.conclusion?.root_cause ?? null : null;
  const showVerdict = shown === "answer" && !!verdict;
  const part = showVerdict ? fault(verdict!).part : null;
  const bearing = !!part && part.startsWith("bearing");
  const markerPart = shown === "check" && open ? (open.test_id === "half_order" ? "feet" : "bearing") : null;
  const hangsTag = (shown === "check" && inv && inv.requested_tests.length > 0) || showVerdict;

  // The tag hangs under the marked part, kept inside the column on narrow screens.
  const left = useMemo(() => {
    const w = `min(${TAG_WIDTH}px, 100%)`;
    const x = `clamp(0px, calc(${(anchor.x * 100).toFixed(2)}% - ${TAG_WIDTH / 2}px), calc(100% - ${w}))`;
    return { marginLeft: x, width: w };
  }, [anchor.x]);

  if (error instanceof ApiError && error.status === 404) return <CaseLost />;
  if (error && !inv) return <ErrorState error={error} />;
  if (!inv) return <Loading>Opening the case…</Loading>;

  const fork = forkOf(inv);

  return (
    <div className={s.page}>
      <CaseHeader inv={inv} entry={entry} read={read} machineName={machine?.name ?? inv.machine.name} evidence={evidence} onEvidence={setEvidence} onLog={() => setLog(true)} />
      <StageLine stages={STAGES} reached={stageIndex(reached)} current={stageIndex(shown)} onSelect={(i) => go(STAGES[i].id)} label="Case stages" />
      <div className={s.grid}>
        <div className={s.left}>
          <div className={s.sceneWrap}>
            <MachineScene
              className={s.scene}
              vibration={read.level ?? 1}
              pattern={verdict && showVerdict ? patternFor(verdict) : "steady"}
              marker={markerPart}
              highlight={part}
              openBearing={bearing}
              partLabel={verdict ? fault(verdict).partName.replace(/^the /, "") : undefined}
              reduceMotion={reduce}
              onAnchor={setAnchor}
              fallback={<PumpDrawing highlight={part} marker={markerPart} />}
            />
            {hangsTag && <span className={s.string} style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }} aria-hidden="true" />}
          </div>
          {shown === "check" && inv.requested_tests.length > 0 && (
            <div className={s.hung} style={left}>
              <MeasureTag inv={inv} entry={entry} caseId={caseId} busy={busy} onDoItHere={doItHere} canAnswer={!!params} error={actionError} />
            </div>
          )}
          {showVerdict && (
            <div className={s.hung} style={left}>
              <VerdictTag inv={inv} />
            </div>
          )}
        </div>
        <div className={s.right} aria-live="polite">
          {shown === "reading" && <StageReading inv={inv} entry={entry} read={read} cap={cap.data} evidence={evidence} onNext={() => go("suspects")} />}
          {shown === "suspects" && <StageSuspects inv={inv} caseId={caseId} onNoted={setInv} onNext={() => go("experiments")} />}
          {shown === "experiments" && <StageExperiments inv={inv} entry={entry} evidence={evidence} onNext={() => go(fork === "ask" ? "check" : "answer")} />}
          {shown === "check" && <StageCheck inv={inv} entry={entry} fork={fork} evidence={evidence} onNext={() => go("answer")} />}
          {shown === "answer" && <StageAnswer inv={inv} entry={entry} caseId={caseId} machineName={machine?.name ?? "the machine"} evidence={evidence} />}
        </div>
      </div>
      <EvidenceLog open={log} onClose={() => setLog(false)} inv={inv} entry={entry} stage={shown} />
    </div>
  );
}
