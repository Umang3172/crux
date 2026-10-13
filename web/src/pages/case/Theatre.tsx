// The virtual experiments, side by side: each suspect simulated on the
// machine's model and laid over the measured spectrum. The traces are the
// server's; the tiles only enter in order of belief.

import { FlaskConical } from "lucide-react";
import type { FaultKind, Spectrum } from "../../api/types";
import type { CaseModel, SuspectRow } from "../../lib/casemodel";
import { num, pct } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { fault } from "../../lib/plain";
import { isOnList } from "../../lib/scenarios";
import type { CaseEntry } from "../../lib/session";
import { Card, Hint, SkeletonRows, SourceTag, cx } from "../../ui/kit";
import { spectrumOf } from "./Signal";

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
  const p = entry.params;
  const drawable = isOnList(p.fault);
  const tiles = model.suspects.filter((s) => s.origin === "catalogue" && isOnList(s.kind));
  const written = model.suspects.filter((s) => s.origin === "written");
  const kinds = tiles.map((t) => t.kind).join(",");

  const spectra = useAsync(
    () => (drawable ? Promise.all(tiles.map((t) => spectrumOf({ fault: p.fault as FaultKind, severity: p.severity, seed: p.seed, extra_noise: p.extra_noise, rpm: p.rpm, hypothesis: t.kind as FaultKind, band }))) : Promise.resolve([] as (Spectrum | null)[])),
    [entry.id, band, kinds, drawable],
  );
  const ready = !!spectra.data && spectra.data.length === tiles.length && spectra.data.every(Boolean);

  if (!drawable) return null;
  const concluded = model.status === "concluded";

  return (
    <Card
      title="Virtual experiments"
      icon={<FlaskConical size={15} />}
      actions={
        <>
          <SourceTag source="simulated" />
          <Hint label="About the virtual experiments">
            Each tile lays one suspect's simulated spectrum (cyan) over the measured one. The simulations ran on the server when the reading came in. Pick a tile to see it large.
          </Hint>
        </>
      }
    >
      {!ready ? (
        spectra.loading ? <SkeletonRows rows={3} /> : <p className="dim small">No spectra on this server.</p>
      ) : (
        <div className="theatre stagger">
          {tiles.map((s, i) => (
            <Tile key={s.kind} i={i} s={s} spec={spectra.data![i]!} on={picked === s.kind} verdict={concluded && s.state === "leading"} onPick={onPick} bar={model.concludeAt} />
          ))}
          {written.map((s, i) => (
            <div key={s.kind} className="exp" style={{ ["--i" as string]: tiles.length + i }}>
              <div className="exp-head">
                <b>{fault(s.kind).name}</b>
                <b className="num">{pct(s.belief)}</b>
              </div>
              <span className="small t-model">written by the critic</span>
              <span className="small dim">No picture: only listed suspects are drawn.</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Tile({ i, s, spec, on, verdict, onPick, bar }: { i: number; s: SuspectRow; spec: Spectrum; on: boolean; verdict: boolean; onPick: (kind: string) => void; bar: number }) {
  const f = fault(s.kind);
  return (
    <button type="button" className={cx("exp", on && "on", s.state === "ruled_out" && "out")} style={{ ["--i" as string]: i }} onClick={() => onPick(s.kind)} aria-pressed={on}>
      <div className="exp-head">
        <b>{f.name}</b>
        <b className="num">{pct(s.belief)}</b>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        <path d={trace(spec.real)} className="exp-real" />
        <path d={trace(spec.simulated)} className="exp-sim run" pathLength={1} />
      </svg>
      <div className="meter">
        <div className={cx("meter-fill", verdict ? "tone-ok" : s.state === "leading" ? "tone-accent" : undefined)} style={{ width: `${(s.belief ?? 0) * 100}%` }} />
        <div className="meter-mark" style={{ left: `${bar * 100}%` }} />
      </div>
      <div className="exp-foot">
        <span>{verdict ? "verdict" : STATE[s.state]}</span>
        <span className="num">{s.match === null ? "" : `match ${num(s.match, 2)}`}</span>
      </div>
    </button>
  );
}
