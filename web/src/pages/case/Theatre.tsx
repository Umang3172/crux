// The virtual experiments, side by side: each suspect simulated on the pump
// model and laid over the measured spectrum. The traces are the server's; the
// reveal only plays back the order they were run in.

import { useEffect } from "react";
import { FlaskConical, RotateCcw } from "lucide-react";
import { spectrum } from "../../api/crux";
import type { FaultKind, Spectrum } from "../../api/types";
import type { CaseModel, SuspectRow } from "../../lib/casemodel";
import { num, pct } from "../../lib/format";
import { useAsync, useReducedMotion, useStepper } from "../../lib/hooks";
import { fault } from "../../lib/plain";
import { isOnList } from "../../lib/scenarios";
import type { CaseEntry } from "../../lib/session";
import { Button, Card, SkeletonRows, cx } from "../../ui/kit";

const W = 200;
const H = 54;

function trace(values: number[]): string {
  const top = Math.max(1e-9, ...values);
  return values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * W).toFixed(1)} ${(H - 3 - (v / top) * (H - 6)).toFixed(1)}`).join("");
}

const STATE: Record<string, string> = { leading: "leading", live: "live", ruled_out: "ruled out", unseen: "cannot exclude", refused: "refused", untested: "untested" };

export function TheatreCard({
  model,
  entry,
  band,
  picked,
  onPick,
}: {
  model: CaseModel;
  entry: CaseEntry;
  band: "raw" | "envelope";
  picked: string | null;
  onPick: (kind: string) => void;
}) {
  const reduced = useReducedMotion();
  const p = entry.params;
  const drawable = isOnList(p.fault);
  const tiles = model.suspects.filter((s) => s.origin === "catalogue" && isOnList(s.kind));
  const written = model.suspects.filter((s) => s.origin === "written");
  const kinds = tiles.map((t) => t.kind).join(",");

  const spectra = useAsync(
    () =>
      drawable
        ? Promise.all(tiles.map((t) => spectrum({ fault: p.fault as FaultKind, severity: p.severity, seed: p.seed, extra_noise: p.extra_noise, hypothesis: t.kind as FaultKind, band })))
        : Promise.resolve([] as (Spectrum | null)[]),
    [entry.id, band, kinds, drawable],
  );
  const ready = !!spectra.data && spectra.data.length === tiles.length && spectra.data.every(Boolean);
  const [shown, replay, playing] = useStepper(tiles.length, 300, `${entry.id}:${band}`);

  // Run the reveal once when the traces first arrive.
  useEffect(() => {
    if (ready && !reduced) replay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, entry.id]);

  if (!drawable) return null;
  const concluded = model.status === "concluded";

  return (
    <Card
      title="Virtual experiments"
      icon={<FlaskConical size={15} />}
      sub={`${tiles.length} suspects, each simulated on the pump model`}
      actions={
        <Button size="sm" icon={<RotateCcw size={12} />} onClick={replay} disabled={!ready || playing}>
          Run the reveal again
        </Button>
      }
      foot="Each tile lays one suspect's simulated spectrum over the measured one. The simulations ran on the server when the case opened; the reveal replays them in the order of belief. Choose a tile to see it large below."
    >
      {!ready ? (
        <SkeletonRows rows={3} />
      ) : (
        <div className="theatre">
          {tiles.map((s, i) => (
            <Tile key={s.kind} s={s} spec={spectra.data![i]!} state={i >= shown ? "wait" : i === shown - 1 && playing ? "run" : "shown"} on={picked === s.kind} verdict={concluded && s.state === "leading"} onPick={onPick} bar={model.concludeAt} />
          ))}
          {written.map((s) => (
            <div key={s.kind} className="exp">
              <div className="exp-head">
                <b>{fault(s.kind).name}</b>
                <b className="num">{pct(s.belief)}</b>
              </div>
              <span className="small t-model">written by the critic</span>
              <span className="small dim">No picture: the server draws only the suspects on its own list. It was simulated and scored all the same.</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Tile({
  s,
  spec,
  state,
  on,
  verdict,
  onPick,
  bar,
}: {
  s: SuspectRow;
  spec: Spectrum;
  state: "wait" | "run" | "shown";
  on: boolean;
  verdict: boolean;
  onPick: (kind: string) => void;
  bar: number;
}) {
  const f = fault(s.kind);
  const belief = state === "wait" ? 0 : (s.belief ?? 0);
  return (
    <button type="button" className={cx("exp", on && "on", state === "wait" && "wait", state !== "wait" && s.state === "ruled_out" && "out")} onClick={() => onPick(s.kind)} aria-pressed={on}>
      <div className="exp-head">
        <b>{f.name}</b>
        <b className="num">{state === "wait" ? "…" : pct(s.belief)}</b>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        <path d={trace(spec.real)} className="exp-real" />
        {state !== "wait" && (
          <path d={trace(spec.simulated)} className={cx("exp-sim", state === "run" && "run")} pathLength={1} />
        )}
      </svg>
      <div className="meter">
        <div className={cx("meter-fill", verdict ? "tone-ok" : s.state === "leading" ? "tone-accent" : undefined)} style={{ width: `${belief * 100}%` }} />
        <div className="meter-mark" style={{ left: `${bar * 100}%` }} />
      </div>
      <div className="exp-foot">
        <span>{state === "wait" ? "queued" : verdict ? "verdict" : STATE[s.state]}</span>
        <span className="num">{s.match === null ? "" : `match ${num(s.match, 2)}`}</span>
      </div>
    </button>
  );
}
